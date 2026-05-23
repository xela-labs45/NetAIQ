/**
 * Telegram Bot — Inbound Command Handler (two-way)
 * ================================================
 *
 * NetAIQ's Telegram integration is otherwise outbound-only (see telegramService.js
 * which pushes alerts). This module adds the *inbound* half: it lets an authorised
 * operator query live network state by messaging the bot.
 *
 * Architecture
 * ------------
 *  - **Long polling**, not webhooks. SMB self-hosted deployments rarely have an
 *    externally reachable URL, so we pull updates from Telegram's `getUpdates`
 *    endpoint instead of receiving pushes. No inbound port, no public DNS needed.
 *  - A single recursive `setTimeout` loop (NOT setInterval) ticks every POLL_MS.
 *    Recursion guarantees one tick never overlaps the next even if a tick runs long.
 *  - The `update_id` offset is kept **in memory only**. Polling cursor state is not
 *    worth persisting — on restart we simply resume from Telegram's backlog and the
 *    chat-ID whitelist + command idempotency make reprocessing harmless.
 *  - The entire tick body is wrapped in try/catch. Network blips are logged and
 *    retried on the next tick; nothing in here may ever crash the server.
 *  - Auth is a single chat-ID whitelist (`telegram_chat_id`). That is the only
 *    auth mechanism — deliberately simple, sufficient for SMB self-hosted.
 *
 * Adding a new command
 * --------------------
 *  1. Write an `async function cmdFoo(ctx)` handler. `ctx` gives you `{ args }`.
 *     Return the reply string (HTML). Throwing is safe — it's caught and turned
 *     into a generic error reply; never let internal details reach the chat.
 *  2. Register it in the COMMANDS map below: `foo: cmdFoo`.
 *  3. Add a line to `cmdHelp` so it shows up in /help.
 * All DB reads use the existing synchronous better-sqlite3 API. Do not trigger
 * scans or external API calls from a handler unless the command explicitly is
 * about that subsystem (e.g. /aps) — keep replies fast.
 *
 * Uses Node 18+ built-in fetch(); no extra npm packages.
 */

const db = require('../db/database');
const telegramService = require('./telegramService');
const unifiService = require('./unifiService');
const alertService = require('./alertService');
const escalatingPollManager = require('./EscalatingPollManager');
const pingService = require('./pingService');
const { checkRateLimit } = require('./aiService');
const { formatInUserTimezone } = require('../utils/dateFormatter');
const { version: APP_VERSION } = require('../../package.json');

const { escapeHtml, formatDowntime, validateBotToken, parseChatIdList } = telegramService;

const LONG_POLL_SEC = 25;                                 // Telegram-side wait per getUpdates
const POLL_MS = 1000;                                     // inter-call gap on success
const ERROR_BACKOFF_MS = 5000;                            // gap after a failed tick (avoid tight loops)
const HTTP_TIMEOUT_MS = (LONG_POLL_SEC + 5) * 1000;       // must exceed the server-side wait
const MAX_CHUNK = 4000;                                   // Telegram hard limit is 4096; leave headroom
const CMD_RATE_MAX = 20;                                  // per-chat command budget
const CMD_RATE_WINDOW_MS = 60_000;                        // per minute
const PING_TARGET_RE = /^[A-Za-z0-9._-]{1,253}$/;         // /ping defensive input check

// ─── In-memory polling state (intentionally not persisted) ──────────
let pollTimer = null;
let updateOffset = 0;
let running = false;
// Set once at module load. Causes the very first poll tick after process boot
// to discard whatever was queued in Telegram's 24h backlog, so a restart
// doesn't replay yesterday's commands. Deliberately NOT reset by
// restartBotPolling() — a settings save shouldn't drop legitimate queued cmds.
let coldStart = true;

// ─── Telegram API helpers ───────────────────────────────────────────

async function tgApi(token, method, payload) {
    const url = `https://api.telegram.org/bot${token}/${method}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
    return response.json();
}

async function sendReply(token, chatId, text, replyTo = null) {
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    if (replyTo != null) {
        // allow_sending_without_reply: don't fail if the original message was deleted.
        payload.reply_to_message_id = replyTo;
        payload.allow_sending_without_reply = true;
    }
    try {
        const data = await tgApi(token, 'sendMessage', payload);
        if (!data.ok) {
            console.error('[TelegramBot] sendMessage rejected:', data.description || JSON.stringify(data));
        }
        return data;
    } catch (err) {
        console.error('[TelegramBot] sendMessage failed:', err.message);
        return { ok: false, description: err.message };
    }
}

// Split a reply on newline boundaries into pieces ≤ MAX_CHUNK. HTML tags in
// our command outputs never span lines, so per-line splitting keeps each chunk
// independently well-formed. A pathological >MAX_CHUNK single line is hard-split
// as a last-resort safety net.
function chunkText(text) {
    if (text.length <= MAX_CHUNK) return [text];
    const lines = text.split('\n');
    const chunks = [];
    let current = '';
    for (const line of lines) {
        if (line.length > MAX_CHUNK) {
            if (current) { chunks.push(current); current = ''; }
            for (let i = 0; i < line.length; i += MAX_CHUNK) chunks.push(line.slice(i, i + MAX_CHUNK));
            continue;
        }
        const candidate = current ? current + '\n' + line : line;
        if (candidate.length > MAX_CHUNK) {
            chunks.push(current);
            current = line;
        } else {
            current = candidate;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

async function sendChunked(token, chatId, text, replyTo = null) {
    const chunks = chunkText(text);
    if (chunks.length === 1) return sendReply(token, chatId, chunks[0], replyTo);
    for (let i = 0; i < chunks.length; i++) {
        const body = i === 0 ? chunks[i] : '… ' + chunks[i];
        // Only the first chunk threads — twenty quote-headers in a row is noise.
        await sendReply(token, chatId, body, i === 0 ? replyTo : null);
    }
}

function maskChatId(chatId) {
    const s = String(chatId);
    return s.length <= 4 ? s : '***' + s.slice(-4);
}

// ─── Time / formatting helpers ──────────────────────────────────────

// SQLite stores timestamps as UTC 'YYYY-MM-DD HH:MM:SS' (no zone). Parse explicitly.
function sqliteToMs(ts) {
    if (!ts) return null;
    const ms = new Date(String(ts).replace(' ', 'T') + 'Z').getTime();
    return Number.isNaN(ms) ? null : ms;
}

// "HH:MM" in the user's configured timezone. formatInUserTimezone → "DD-MM-YYYY HH:MM:SS".
function clock(date) {
    const full = formatInUserTimezone(date);
    return full.length >= 16 ? full.slice(11, 16) : full;
}

function agoText(ms) {
    if (ms == null) return 'unknown';
    // Floor everything so the boundaries are monotonic — Math.round caused a
    // jump from "just now" straight to "1m ago" at the 30s mark.
    const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
}

function nextRunText(status, unit /* 's' | 'm' */) {
    if (!status || !status.nextRunExpectedAt) return status?.isExecuting ? 'running now' : 'unknown';
    if (status.isExecuting) return 'running now';
    const secs = Math.round((status.nextRunExpectedAt - Date.now()) / 1000);
    if (secs <= 0) return 'imminent';
    return unit === 'm' ? `${Math.max(1, Math.round(secs / 60))}m` : `${secs}s`;
}

const SEVERITY_ICON = { critical: '🔴', warning: '🟡', info: '🟢' };
function sevIcon(sev) { return SEVERITY_ICON[String(sev).toLowerCase()] || '⚪️'; }

// Latency-tiered status icon for an online/offline device row.
function deviceIcon(status, latency) {
    if (status !== 'up') return '🔴';
    if (latency != null && latency > 100) return '🟡';
    return '🟢';
}

function name(d) {
    return escapeHtml(d.hostname || d.ip_address || 'unknown');
}

// ─── Device-state query (shared by /status /online /offline /critical) ──

// Latest ping per device + the most recent 'up' timestamp (for offline duration).
// `where` is interpolated as a literal SQL fragment; `params` are safely bound.
function getDeviceStates(where = '', params = []) {
    return db.prepare(`
        SELECT d.id, d.hostname, d.ip_address, d.mac_address, d.vendor, d.device_type,
               d.is_critical, d.segment_id, d.notes, d.created_at,
               p.status   AS status,
               p.latency_ms AS latency_ms,
               p.timestamp  AS last_ping,
               (SELECT MAX(timestamp) FROM ping_history
                  WHERE device_id = d.id AND status = 'up') AS last_up
        FROM devices d
        LEFT JOIN ping_history p
          ON p.id = (SELECT id FROM ping_history
                       WHERE device_id = d.id
                       ORDER BY timestamp DESC LIMIT 1)
        ${where}
    `).all(...params);
}

function offlineMs(d) {
    const ref = sqliteToMs(d.last_up) ?? sqliteToMs(d.created_at);
    return ref == null ? null : Date.now() - ref;
}

// ─── Command handlers ───────────────────────────────────────────────

async function cmdStatus() {
    const devices = getDeviceStates();
    const total = devices.length;
    const offline = devices.filter(d => d.status !== 'up');
    const offlineNames = offline.slice(0, 3).map(name).join(', ');

    const counts = alertService.getUnreadCount();

    const lines = [
        '🌐 <b>NetAIQ Status</b>',
        `<b>Devices:</b> ${total} monitored · ${offline.length} down`,
    ];
    if (offline.length) {
        lines.push(`<b>Down:</b> ${offlineNames}${offline.length > 3 ? ', …' : ''}`);
    }
    lines.push(`<b>Alerts:</b> ${counts.unread_count} unread (${counts.critical_count} critical)`);

    // AP line only if UniFi is configured & reachable — degrade silently otherwise.
    try {
        const wlan = await unifiService.getWlanHealth();
        if (wlan) {
            lines.push(`<b>Access points:</b> ${wlan.num_ap} · ${wlan.num_disconnected} down · ${wlan.num_user} clients`);
        }
    } catch (_) { /* omit AP line on failure */ }

    const cp = require('../jobs/criticalPingJob').getStatus();
    const sj = require('../jobs/scanJob').getStatus();
    lines.push(`<b>Schedules:</b> critical poll in ${nextRunText(cp, 's')} · scan in ${nextRunText(sj, 'm')}`);

    return lines.join('\n');
}

async function cmdOnline() {
    const rows = getDeviceStates()
        .filter(d => d.status === 'up')
        .sort((a, b) => (a.latency_ms ?? 1e9) - (b.latency_ms ?? 1e9));

    if (!rows.length) return 'No devices currently up.';

    const body = rows.map(d => {
        const lat = d.latency_ms != null ? `${Math.round(d.latency_ms)}ms` : 'n/a';
        return `${deviceIcon(d.status, d.latency_ms)} ${name(d)} · ${escapeHtml(d.ip_address)} · ${lat}`;
    });
    return [`🟢 <b>Online devices</b> (${rows.length})`, ...body].join('\n');
}

async function cmdOffline() {
    const rows = getDeviceStates()
        .filter(d => d.status !== 'up')
        .map(d => ({ d, off: offlineMs(d) }))
        .sort((a, b) => (b.off ?? 0) - (a.off ?? 0)); // longest offline first

    if (!rows.length) return 'All monitored devices are up.';

    const body = rows.map(({ d, off }) =>
        `🔴 ${name(d)} · ${escapeHtml(d.ip_address)} · down ${formatDowntime(off)}`);
    return [`🔴 <b>Offline devices</b> (${rows.length})`, ...body].join('\n');
}

async function cmdCritical() {
    const rows = getDeviceStates('WHERE d.is_critical = 1');
    const escalating = escalatingPollManager.getEscalatingStatus();
    const escById = new Map(escalating.map(e => [e.deviceId, e]));

    if (!rows.length) return 'No devices flagged critical.';

    const body = rows.map(d => {
        const esc = escById.get(d.id);
        if (esc) {
            return `🔴 ${name(d)} · ${escapeHtml(d.ip_address)} · down ${formatDowntime(offlineMs(d))} · escalating ${esc.attempts}/${esc.max}`;
        }
        if (d.status === 'up') {
            const lat = d.latency_ms != null ? `${Math.round(d.latency_ms)}ms` : 'n/a';
            return `${deviceIcon(d.status, d.latency_ms)} ${name(d)} · ${escapeHtml(d.ip_address)} · ${lat}`;
        }
        return `🔴 ${name(d)} · ${escapeHtml(d.ip_address)} · down ${formatDowntime(offlineMs(d))}`;
    });

    const out = [`⚠️ <b>Critical devices</b> (${rows.length})`, ...body];
    if (escalating.length) out.push(`<i>${escalating.length} escalating poll${escalating.length === 1 ? '' : 's'} active.</i>`);
    return out.join('\n');
}

function renderAlerts(rows, header, { italicizeRead = false } = {}) {
    if (!rows.length) return `🔔 <b>${header}</b>\nNothing to show.`;
    const body = rows.map(a => {
        const who = a.hostname || a.ip_address;
        const subject = who ? `${escapeHtml(who)} · ` : '';
        const row = `${sevIcon(a.severity)} ${clock(a.created_at)} · ${subject}${escapeHtml(a.message)}`;
        return italicizeRead && a.is_read ? `<i>${row}</i>` : row;
    });
    return [`🔔 <b>${header}</b>`, ...body].join('\n');
}

async function cmdAlerts(ctx) {
    const all = (ctx.args[0] || '').toLowerCase() === 'all';
    if (all) {
        const rows = db.prepare(`
            SELECT a.id, a.message, a.severity, a.is_read, a.created_at,
                   d.hostname, d.ip_address
            FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
            ORDER BY a.created_at DESC LIMIT 20
        `).all();
        return renderAlerts(rows, `Alerts — last ${rows.length}`, { italicizeRead: true });
    }
    const rows = db.prepare(`
        SELECT a.id, a.message, a.severity, a.is_read, a.created_at,
               d.hostname, d.ip_address
        FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
        WHERE a.is_read = 0
        ORDER BY a.created_at DESC LIMIT 10
    `).all();
    if (!rows.length) return 'No unread alerts.';
    return renderAlerts(rows, `Unread alerts (${rows.length})`)
        + '\n<i>Use /markread to mark all as read.</i>';
}

async function cmdAps() {
    let resp;
    try {
        resp = await unifiService.getDevices();
    } catch (_) {
        return '📶 UniFi unreachable.';
    }
    if (!resp) return '📶 UniFi not configured.';

    const list = (resp.data || resp || []).filter(x => x && x.type === 'uap');
    if (!list.length) return 'No access points reported by UniFi.';

    const body = list.map(ap => {
        const apName = escapeHtml(ap.name || ap.mac || 'Unknown AP');
        if (ap.state === 1) {
            const clients = ap['num_sta'] ?? ap.user_num_sta ?? 0;
            return `🟢 ${apName} · ${clients} clients`;
        }
        const seen = ap.last_seen ? ` · last seen ${agoText(ap.last_seen * 1000)}` : '';
        return `🔴 ${apName} · offline${seen}`;
    });
    return [`📶 <b>Access points</b> (${list.length})`, ...body].join('\n');
}

async function cmdSegments() {
    const rows = db.prepare(`
        SELECT s.id, s.name, s.cidr,
               (SELECT COUNT(*) FROM devices d WHERE d.segment_id = s.id) AS device_count,
               (SELECT MAX(scanned_at) FROM scan_results sr WHERE sr.segment_id = s.id) AS last_scan
        FROM segments s
        ORDER BY s.name
    `).all();

    if (!rows.length) return 'No segments configured.';

    const DAY_MS = 24 * 60 * 60 * 1000;
    const body = rows.map(s => {
        const lastScanMs = sqliteToMs(s.last_scan);
        const fresh = lastScanMs != null && (Date.now() - lastScanMs) < DAY_MS;
        const dot = fresh ? '🟢' : '⚪';
        const scan = lastScanMs != null ? `last scan ${agoText(lastScanMs)}` : 'never scanned';
        return `${dot} ${escapeHtml(s.name)} · ${escapeHtml(s.cidr)} · ${s.device_count} devices · ${scan}`;
    });
    return [`🗺 <b>Network segments</b> (${rows.length})`, ...body].join('\n');
}

async function cmdMarkread() {
    const info = db.prepare('UPDATE alerts SET is_read = 1 WHERE is_read = 0').run();
    return `✅ Marked ${info.changes} alert${info.changes === 1 ? '' : 's'} as read.`;
}

async function cmdVersion() {
    const uptimeMs = Math.floor(process.uptime() * 1000);
    return [
        '🤖 <b>NetAIQ Bot</b>',
        `<b>Version:</b> ${escapeHtml(APP_VERSION)}`,
        `<b>Node:</b> ${escapeHtml(process.version)}`,
        `<b>Uptime:</b> ${formatDowntime(uptimeMs)}`,
        `<b>Time:</b> ${escapeHtml(formatInUserTimezone(new Date()))}`,
    ].join('\n');
}

async function cmdDevice(ctx) {
    const target = (ctx.args[0] || '').trim();
    if (!target) return '<i>Usage:</i> /device &lt;name|ip&gt;';

    const rows = getDeviceStates(
        'WHERE LOWER(d.hostname) = LOWER(?) OR d.ip_address = ?',
        [target, target]
    );
    if (!rows.length) return `No device matches "${escapeHtml(target)}".`;

    // Prefer exact IP match if multiple; otherwise first row.
    const d = rows.find(r => r.ip_address === target) || rows[0];

    let segmentName = null;
    if (d.segment_id) {
        const seg = db.prepare('SELECT name FROM segments WHERE id = ?').get(d.segment_id);
        segmentName = seg?.name || null;
    }

    const statusLine = d.status === 'up'
        ? `${deviceIcon(d.status, d.latency_ms)} up${d.latency_ms != null ? ` · ${Math.round(d.latency_ms)}ms` : ''}`
        : `🔴 down · ${formatDowntime(offlineMs(d))}`;

    const lines = [
        `📡 <b>${name(d)}</b>`,
        `<b>IP:</b> ${escapeHtml(d.ip_address)}`,
    ];
    if (d.mac_address) lines.push(`<b>MAC:</b> ${escapeHtml(d.mac_address)}`);
    if (d.vendor) lines.push(`<b>Vendor:</b> ${escapeHtml(d.vendor)}`);
    if (d.device_type) lines.push(`<b>Type:</b> ${escapeHtml(d.device_type)}`);
    if (segmentName) lines.push(`<b>Segment:</b> ${escapeHtml(segmentName)}`);
    lines.push(`<b>Status:</b> ${statusLine}`);
    if (d.last_up) lines.push(`<b>Last up:</b> ${agoText(sqliteToMs(d.last_up))}`);
    if (d.last_ping) lines.push(`<b>Last checked:</b> ${agoText(sqliteToMs(d.last_ping))}`);
    if (d.notes) lines.push(`<b>Notes:</b> ${escapeHtml(d.notes)}`);
    if (d.is_critical) lines.push('<i>Flagged critical.</i>');
    return lines.join('\n');
}

async function cmdSegment(ctx) {
    const target = (ctx.args.join(' ') || '').trim();
    if (!target) return '<i>Usage:</i> /segment &lt;name&gt;';

    const seg = db.prepare(`
        SELECT s.id, s.name, s.cidr, s.description, s.color,
               (SELECT MAX(scanned_at) FROM scan_results sr WHERE sr.segment_id = s.id) AS last_scan
        FROM segments s
        WHERE LOWER(s.name) = LOWER(?)
    `).get(target);
    if (!seg) return `No segment matches "${escapeHtml(target)}".`;

    const devices = getDeviceStates('WHERE d.segment_id = ?', [seg.id]);
    const online = devices.filter(d => d.status === 'up').length;
    const offline = devices.length - online;

    const lines = [
        `🗺 <b>${escapeHtml(seg.name)}</b>`,
        `<b>CIDR:</b> ${escapeHtml(seg.cidr)}`,
    ];
    if (seg.description) lines.push(`<b>Description:</b> ${escapeHtml(seg.description)}`);
    lines.push(`<b>Devices:</b> ${devices.length} (${online} up · ${offline} down)`);
    lines.push(`<b>Last scan:</b> ${seg.last_scan ? agoText(sqliteToMs(seg.last_scan)) : 'never'}`);
    return lines.join('\n');
}

async function cmdPing(ctx) {
    const target = (ctx.args[0] || '').trim();
    if (!target) return '<i>Usage:</i> /ping &lt;ip|hostname&gt;';
    if (!PING_TARGET_RE.test(target)) {
        return '<i>Usage:</i> /ping &lt;ip|hostname&gt; — letters, digits, dots, dashes only.';
    }
    const res = await pingService.performPing({ ip_address: target });
    if (res.status === 'up') {
        const latency = res.latency_ms != null ? `${res.latency_ms.toFixed(1)}ms` : 'n/a';
        return `🟢 ${escapeHtml(target)} · alive · ${latency} · ${res.packet_loss}% loss`;
    }
    return `🔴 ${escapeHtml(target)} · unreachable · ${res.packet_loss}% loss`;
}

async function cmdHelp() {
    return [
        '🤖 <b>NetAIQ Bot</b>',
        '',
        '<b>📊 Status</b>',
        '/status — Network snapshot',
        '/online — Devices currently up',
        '/offline — Devices currently down',
        '/critical — Critical devices + escalating polls',
        '/aps — Access point health',
        '/segments — Network segments',
        '/alerts — Last 10 unread alerts',
        '/alerts_all — Last 20 alerts (any state)',
        '',
        '<b>🔍 Lookups</b>',
        '/device &lt;name|ip&gt; — Device detail',
        '/segment &lt;name&gt; — Segment detail',
        '/ping &lt;ip|hostname&gt; — One-shot ping',
        '',
        '<b>⚡ Actions</b>',
        '/markread — Mark all alerts as read',
        '',
        '<b>ℹ️ Info</b>',
        '/version — Bot version &amp; uptime',
        '/help — This message',
        '',
        `<i>NetAIQ v${escapeHtml(APP_VERSION)} · ${escapeHtml(formatInUserTimezone(new Date()))}</i>`,
    ].join('\n');
}

const COMMANDS = {
    status: cmdStatus,
    online: cmdOnline,
    offline: cmdOffline,
    critical: cmdCritical,
    alerts: cmdAlerts,
    // Telegram commands are single tokens (no spaces), so /alerts_all is the
    // canonical "all alerts" command. "/alerts all" still works via arg parsing.
    alerts_all: () => cmdAlerts({ args: ['all'] }),
    aps: cmdAps,
    segments: cmdSegments,
    device: cmdDevice,
    segment: cmdSegment,
    ping: cmdPing,
    markread: cmdMarkread,
    version: cmdVersion,
    help: cmdHelp,
};

// Shown in Telegram's `/` autocomplete. Descriptions ≤ 256 chars each.
const BOT_COMMAND_LIST = [
    { command: 'status',     description: 'Network health snapshot' },
    { command: 'online',     description: 'Online devices only' },
    { command: 'offline',    description: 'Offline devices only' },
    { command: 'critical',   description: 'Critical devices + escalating polls' },
    { command: 'alerts',     description: 'Last 10 unread alerts' },
    { command: 'alerts_all', description: 'Last 20 alerts (all)' },
    { command: 'aps',        description: 'UniFi access point health' },
    { command: 'segments',   description: 'Network segments summary' },
    { command: 'device',     description: 'Device detail by name or IP' },
    { command: 'segment',    description: 'Segment detail by name' },
    { command: 'ping',       description: 'One-shot ping of an IP or hostname' },
    { command: 'markread',   description: 'Mark all alerts as read' },
    { command: 'version',    description: 'Bot version and uptime' },
    { command: 'help',       description: 'List all commands' },
];

// Best-effort registration with Telegram's `/` autocomplete. Idempotent —
// Telegram replaces the list each call. Never throws; the bot still works
// fine without autocomplete if this fails.
async function registerBotCommands(token) {
    try {
        const data = await tgApi(token, 'setMyCommands', { commands: BOT_COMMAND_LIST });
        if (!data.ok) {
            console.warn('[TelegramBot] setMyCommands rejected:', data.description || JSON.stringify(data));
        } else {
            console.log(`[TelegramBot] registered ${BOT_COMMAND_LIST.length} commands with Telegram`);
        }
    } catch (err) {
        console.warn('[TelegramBot] setMyCommands failed (non-fatal):', err.message);
    }
}

// ─── Update handling ────────────────────────────────────────────────

async function handleUpdate(update, token, allowed) {
    const msg = update.message;
    if (!msg || typeof msg.text !== 'string') return; // ignore non-text updates silently

    const chatId = msg.chat && msg.chat.id;
    if (chatId == null) return;

    // Auth: chat-ID allow-list (single or comma-separated multi-operator).
    if (!allowed || allowed.size === 0) {
        console.warn('[TelegramBot] telegram_chat_id not configured — ignoring all updates');
        return;
    }
    if (!allowed.has(String(chatId))) {
        // Deliberately silent — no reply. Anyone can DM a Telegram bot, so
        // responding would let an attacker burn our sendMessage rate budget
        // by spamming DMs. Forensics live in this warn line.
        console.warn(`[TelegramBot] unauthorised access attempt from chat ID ${chatId}`);
        return;
    }

    const text = msg.text.trim();
    if (!text.startsWith('/')) return; // ignore non-command messages silently

    // Per-chat rate limit — stops fat-fingering and accidental scripts without
    // throttling separate operators against each other.
    const rl = checkRateLimit('tg:cmd:' + chatId, CMD_RATE_MAX, CMD_RATE_WINDOW_MS);
    if (!rl.allowed) {
        await sendReply(token, chatId, `⏳ Too many commands — try again in ${rl.resetIn}s.`);
        return;
    }

    // "/alerts@MyBot all" → cmd "alerts", args ["all"]
    const parts = text.split(/\s+/);
    const cmd = parts[0].slice(1).split('@')[0].toLowerCase();
    const args = parts.slice(1);

    console.log(`[TelegramBot] command "/${cmd}" from chat ${maskChatId(chatId)}`);

    const handler = COMMANDS[cmd];
    if (!handler) {
        await sendReply(token, chatId, 'Unknown command. Try /help for the command list.');
        return;
    }

    try {
        const reply = await handler({ args });
        await sendChunked(token, chatId, reply, msg.message_id);
    } catch (err) {
        console.error(`[TelegramBot] error running /${cmd}:`, err.message);
        await sendReply(token, chatId, '⚠️ Command failed. Check server logs for details.');
    }
}

async function pollTick() {
    let tickError = false;
    try {
        const settings = telegramService.getSettings();
        const token = settings.telegram_bot_token;

        // Config may have changed under us (without a save-triggered restart) — bail this tick.
        if (!token || settings.telegram_commands_enabled !== '1') return;

        // Parse the allow-list once per tick — invalid entries (e.g. a half-typed
        // edit in the DB) cause the parse to throw; we degrade to "ignore all".
        let allowed;
        try {
            allowed = new Set(parseChatIdList(settings.telegram_chat_id));
        } catch (err) {
            console.warn('[TelegramBot] invalid telegram_chat_id — ignoring all updates this tick:', err.message);
            allowed = new Set();
        }

        // First tick after process boot: discard whatever's queued so we don't
        // replay yesterday's commands. offset=-1 returns at most the most
        // recent update; we advance past it without invoking handlers.
        if (coldStart) {
            coldStart = false;
            try {
                const skipUrl = `https://api.telegram.org/bot${token}/getUpdates?offset=-1&limit=1&timeout=0&allowed_updates=${encodeURIComponent('["message"]')}`;
                const res = await fetch(skipUrl, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
                const data = await res.json();
                if (data && data.ok && Array.isArray(data.result) && data.result.length) {
                    updateOffset = data.result[data.result.length - 1].update_id + 1;
                    console.log(`[TelegramBot] cold start — skipped backlog up to update_id ${updateOffset - 1}`);
                }
            } catch (err) {
                console.warn('[TelegramBot] cold-start backlog skip failed (continuing):', err.message);
            }
            return; // pick up at the new offset on the next tick
        }

        let data;
        try {
            const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${updateOffset}&timeout=${LONG_POLL_SEC}&allowed_updates=${encodeURIComponent('["message"]')}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
            data = await res.json();
        } catch (err) {
            console.error('[TelegramBot] getUpdates failed (will retry):', err.message);
            tickError = true;
            return;
        }

        if (!data || !data.ok || !Array.isArray(data.result)) {
            // 409 = another consumer is polling this bot (webhook set, or duplicate
            // instance). Keep-polling would just hammer the same error forever.
            if (data && data.error_code === 409) {
                console.error('[TelegramBot] 409 Conflict — another consumer is polling this bot. Stopping. Delete the webhook (or shut down the other instance), then re-save Telegram settings to restart.');
                stopBotPolling();
                return;
            }
            if (data && !data.ok) console.error('[TelegramBot] getUpdates rejected:', data.description);
            tickError = true;
            return;
        }

        for (const update of data.result) {
            updateOffset = update.update_id + 1; // advance even if the update is rejected
            await handleUpdate(update, token, allowed);
        }
    } catch (err) {
        // Absolute backstop — the poll loop must never throw.
        console.error('[TelegramBot] poll tick error:', err.message);
        tickError = true;
    } finally {
        if (running) pollTimer = setTimeout(pollTick, tickError ? ERROR_BACKOFF_MS : POLL_MS);
    }
}

// ─── Lifecycle ──────────────────────────────────────────────────────

function startBotPolling() {
    if (running) return; // idempotent

    const settings = telegramService.getSettings();
    const token = settings.telegram_bot_token;
    const chatId = settings.telegram_chat_id;

    if (!token || !chatId || settings.telegram_commands_enabled !== '1') {
        console.log('[TelegramBot] not starting — token/chat ID missing or commands disabled');
        return;
    }
    let operators;
    try {
        validateBotToken(token);
        operators = parseChatIdList(chatId);
        if (operators.length === 0) throw new Error('No chat IDs configured');
    } catch (err) {
        console.warn('[TelegramBot] not starting — invalid credentials:', err.message);
        return;
    }

    running = true;
    console.log(`[TelegramBot] polling started (${operators.length} operator${operators.length === 1 ? '' : 's'} authorised)`);
    pollTimer = setTimeout(pollTick, POLL_MS);
    // Register the slash-command list with Telegram for /-autocomplete. Fire and
    // forget — bootstrap stays fast and the bot still works without autocomplete.
    registerBotCommands(token);
}

function stopBotPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    if (running) {
        running = false;
        console.log('[TelegramBot] polling stopped');
    }
}

function restartBotPolling() {
    console.log('[TelegramBot] polling restart requested');
    stopBotPolling();
    startBotPolling();
}

module.exports = {
    startBotPolling,
    stopBotPolling,
    restartBotPolling,
};
