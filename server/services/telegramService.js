const db = require('../db/database');
const { formatInUserTimezone, normalizeDate } = require('../utils/dateFormatter');

function escapeHtml(str) {
    if (!str) return str;
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// Telegram bot tokens are always in the format  <bot_id>:<35-char alphanumeric key>
const TELEGRAM_TOKEN_RE = /^\d+:[A-Za-z0-9_-]{30,}$/;
// Chat IDs are either a numeric string (private/group) or an @username
const TELEGRAM_CHAT_ID_RE = /^-?\d+$|^@[A-Za-z0-9_]{3,}$/;

function validateBotToken(token) {
    if (typeof token !== 'string' || !TELEGRAM_TOKEN_RE.test(token)) {
        throw new Error('Invalid Telegram bot token format');
    }
}

function validateChatId(chatId) {
    if (typeof chatId !== 'string' || !TELEGRAM_CHAT_ID_RE.test(String(chatId).trim())) {
        throw new Error('Invalid Telegram chat ID format');
    }
}

// Lazy-load aiService to avoid circular dependency
let _aiService = null;
function getAiService() {
    if (!_aiService) _aiService = require('./aiService');
    return _aiService;
}

/**
 * Telegram Bot Notification Service
 * 
 * Uses Node 18+ built-in fetch() — no extra npm packages required.
 * All calls are async and fire-and-forget; Telegram failures
 * are logged but never block or crash the main application.
 */

function getSettings() {
    try {
        const rows = db.prepare(
            "SELECT key, value FROM settings WHERE key LIKE 'telegram_%'"
        ).all();
        return rows.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});
    } catch (err) {
        console.error('Telegram: failed to read settings:', err.message);
        return {};
    }
}

function isEnabled() {
    const settings = getSettings();
    return settings.telegram_alerts_enabled === '1'
        && !!settings.telegram_bot_token
        && !!settings.telegram_chat_id;
}

// Returns true if the specific event key is enabled (defaults to true when not yet set)
function isEventEnabled(settings, key) {
    return settings[key] !== '0';
}

/**
 * Send a message via the Telegram Bot API.
 * @param {string} message — HTML-formatted message body
 * @returns {Promise<{ok: boolean, description?: string}>}
 */
async function sendMessage(message) {
    const settings = getSettings();
    const { telegram_bot_token, telegram_chat_id, telegram_alerts_enabled } = settings;

    if (telegram_alerts_enabled !== '1') {
        return { ok: false, description: 'Telegram alerts are disabled' };
    }

    if (!telegram_bot_token || !telegram_chat_id) {
        return { ok: false, description: 'Telegram bot token or chat ID not configured' };
    }

    try {
        validateBotToken(telegram_bot_token);
        validateChatId(telegram_chat_id);
    } catch (err) {
        console.error('Telegram: invalid credentials in settings:', err.message);
        return { ok: false, description: err.message };
    }

    const url = `https://api.telegram.org/bot${telegram_bot_token}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegram_chat_id,
                text: message,
                parse_mode: 'HTML'
            }),
            signal: AbortSignal.timeout(10000)
        });

        const data = await response.json();

        if (data.ok) {
            console.log('Telegram: message sent successfully');
        } else {
            console.error('Telegram API error:', data.description || JSON.stringify(data));
        }

        return data;
    } catch (err) {
        console.error('Telegram: failed to send message:', err.message);
        return { ok: false, description: err.message };
    }
}

// ─── Device History Enrichment ───────────────────────────────────

function getDeviceOutageHistory(deviceId, segmentId) {
    try {
        const recentOutages = db.prepare(`
            SELECT created_at FROM alerts
            WHERE device_id = ? AND alert_type = 'device_down'
              AND created_at > datetime('now', '-30 days')
            ORDER BY created_at DESC LIMIT 6
        `).all(deviceId);

        const durationRows = db.prepare(`
            SELECT d.created_at as down_at,
                   ROUND((julianday(MIN(u.created_at)) - julianday(d.created_at)) * 1440, 0) as duration_min
            FROM alerts d
            JOIN alerts u ON u.device_id = d.device_id
              AND u.alert_type = 'device_up' AND u.created_at > d.created_at
            WHERE d.device_id = ? AND d.alert_type = 'device_down'
              AND d.created_at > datetime('now', '-30 days')
            GROUP BY d.id ORDER BY d.created_at DESC LIMIT 5
        `).all(deviceId);

        const pingStats = db.prepare(`
            SELECT
                ROUND(100.0 * SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) / COUNT(*), 1) as uptime_pct,
                ROUND(AVG(CASE WHEN status = 'up' AND latency_ms IS NOT NULL THEN latency_ms END), 1) as avg_latency_ms
            FROM ping_history WHERE device_id = ? AND timestamp > datetime('now', '-7 days')
        `).get(deviceId);

        const prePings = db.prepare(`
            SELECT status, latency_ms FROM ping_history
            WHERE device_id = ? ORDER BY timestamp DESC LIMIT 5
        `).all(deviceId);

        let concurrentOffline = [];
        if (segmentId) {
            concurrentOffline = db.prepare(`
                SELECT d.hostname, d.ip_address
                FROM devices d
                JOIN ping_history latest ON latest.id = (
                    SELECT id FROM ping_history
                    WHERE device_id = d.id
                      AND timestamp > datetime('now', '-1 hour')
                    ORDER BY timestamp DESC LIMIT 1
                )
                WHERE d.segment_id = ? AND d.id != ? AND latest.status = 'down'
            `).all(segmentId, deviceId);
        }

        const deviceInfo = db.prepare(`
            SELECT device_type, notes, vendor, is_wired,
                   (SELECT device_type_suggestion FROM ai_device_identifications WHERE device_id = devices.id LIMIT 1) as ai_type
            FROM devices WHERE id = ?
        `).get(deviceId);

        const durationsWithValue = durationRows.filter(r => r.duration_min != null && r.duration_min > 0);
        const avgDuration = durationsWithValue.length > 0
            ? Math.round(durationsWithValue.reduce((s, r) => s + r.duration_min, 0) / durationsWithValue.length)
            : null;

        return {
            outage_count_30d: recentOutages.length,
            recent_outage_times: recentOutages.slice(0, 5).map(r => r.created_at),
            avg_outage_duration_min: avgDuration,
            uptime_7d_pct: pingStats?.uptime_pct ?? null,
            avg_latency_ms: pingStats?.avg_latency_ms ?? null,
            pre_outage_pings: prePings.map(p => p.status + (p.latency_ms ? ` (${p.latency_ms}ms)` : '')),
            concurrent_offline_in_segment: concurrentOffline.map(d => d.hostname || d.ip_address),
            device_type: deviceInfo?.ai_type || deviceInfo?.device_type || null,
            device_notes: deviceInfo?.notes || null,
            vendor: deviceInfo?.vendor || null,
            is_wired: deviceInfo?.is_wired != null ? !!deviceInfo.is_wired : null,
        };
    } catch (err) {
        console.error('getDeviceOutageHistory error (non-critical):', err.message);
        return {};
    }
}

// ─── Downtime Formatter ──────────────────────────────────────────

function formatDowntime(ms) {
    if (!ms || ms < 0) return 'unknown';

    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) return `${hours} hour${hours > 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    return 'less than a minute';
}

function formatTimestamp() {
    return formatInUserTimezone(new Date());
}

/**
 * Append AI-generated remediation steps to a base message.
 * Returns the base message unchanged if AI is unavailable or fails.
 */
async function appendAiSection(baseMessage, eventType, context) {
    try {
        const aiService = getAiService();
        const aiText = await aiService.enhanceAlertWithAI(eventType, context);
        if (!aiText) return baseMessage;
        return baseMessage + '\n\n' + '🤖 <b>AI Recommended Actions</b>\n' + aiText;
    } catch (err) {
        console.error('Telegram AI enhancement error (non-blocking):', err.message);
        return baseMessage;
    }
}

// ─── Alert Formatters ────────────────────────────────────────────

/**
 * Critical device went offline.
 */
async function sendCriticalDeviceOffline(device, segmentName) {
    if (!isEnabled()) return;
    const settings = getSettings();
    if (!isEventEnabled(settings, 'telegram_alert_critical_offline')) return;

    // Look up segment CIDR for AI context
    let segmentCidr = null;
    if (device.segment_id) {
        try {
            const seg = db.prepare('SELECT cidr FROM segments WHERE id = ?').get(device.segment_id);
            segmentCidr = seg?.cidr || null;
        } catch (_) { /* non-critical */ }
    }

    const baseMessage = [
        `🔴 <b>Critical Device Offline</b>`,
        ``,
        `<b>Device:</b> ${escapeHtml(device.hostname || device.ip_address)}`,
        `<b>IP:</b> ${escapeHtml(device.ip_address)}`,
        device.mac_address ? `<b>MAC:</b> ${escapeHtml(device.mac_address)}` : null,
        segmentName ? `<b>Segment:</b> ${escapeHtml(segmentName)}` : null,
        device.last_seen ? `<b>Last Seen:</b> ${escapeHtml(String(device.last_seen))}` : null,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ This device is marked as critical.`,
        `Check the network immediately.`
    ].filter(Boolean).join('\n');

    const history = getDeviceOutageHistory(device.id, device.segment_id);

    const aiContext = {
        hostname: device.hostname,
        ip_address: device.ip_address,
        mac_address: device.mac_address,
        segment_name: segmentName,
        segment_cidr: segmentCidr,
        last_seen: device.last_seen,
        minutes_offline: device.last_seen ? Math.round((Date.now() - normalizeDate(device.last_seen).getTime()) / 60000) : null,
        ...history
    };

    const message = await appendAiSection(baseMessage, 'critical_device_offline', aiContext);
    return sendMessage(message);
}

/**
 * Critical device came back online.
 */
async function sendCriticalDeviceOnline(device, segmentName, downtimeMs) {
    if (!isEnabled()) return;
    const settings = getSettings();
    if (!isEventEnabled(settings, 'telegram_alert_critical_online')) return;

    const downtimeStr = formatDowntime(downtimeMs);

    const baseMessage = [
        `🟢 <b>Critical Device Restored</b>`,
        ``,
        `<b>Device:</b> ${escapeHtml(device.hostname || device.ip_address)}`,
        `<b>IP:</b> ${escapeHtml(device.ip_address)}`,
        segmentName ? `<b>Segment:</b> ${escapeHtml(segmentName)}` : null,
        `<b>Downtime:</b> ${downtimeStr}`,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `✅ Device is back online.`
    ].filter(Boolean).join('\n');

    const history = getDeviceOutageHistory(device.id, device.segment_id);

    const aiContext = {
        hostname: device.hostname,
        ip_address: device.ip_address,
        segment_name: segmentName,
        downtime: downtimeStr,
        device_type: history.device_type || null,
        outage_count_30d: history.outage_count_30d ?? null,
        avg_outage_duration_min: history.avg_outage_duration_min ?? null,
        uptime_7d_pct: history.uptime_7d_pct ?? null,
        device_notes: history.device_notes || null,
    };

    const message = await appendAiSection(baseMessage, 'critical_device_online', aiContext);
    return sendMessage(message);
}

/**
 * Access Point went offline.
 */
async function sendApOffline(ap) {
    if (!isEnabled()) return;
    const settings = getSettings();
    if (!isEventEnabled(settings, 'telegram_alert_ap_offline')) return;

    const lastSeenFormatted = ap.last_seen
        ? formatInUserTimezone(ap.last_seen)
        : null;

    const baseMessage = [
        `🔴 <b>Access Point Offline</b>`,
        ``,
        `<b>AP Name:</b> ${escapeHtml(ap.name) || 'Unknown AP'}`,
        ap.mac ? `<b>MAC:</b> ${escapeHtml(ap.mac)}` : null,
        lastSeenFormatted ? `<b>Last Seen:</b> ${lastSeenFormatted}` : null,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ Check UniFi and physical connection.`
    ].filter(Boolean).join('\n');

    const aiContext = {
        name: ap.name,
        mac: ap.mac,
        last_seen: lastSeenFormatted,
        minutes_offline: ap.last_seen ? Math.round((Date.now() - normalizeDate(ap.last_seen).getTime()) / 60000) : null
    };

    const message = await appendAiSection(baseMessage, 'ap_offline', aiContext);
    return sendMessage(message);
}

/**
 * Access Point came back online.
 */
async function sendApOnline(ap, downtimeMs) {
    if (!isEnabled()) return;
    const settings = getSettings();
    if (!isEventEnabled(settings, 'telegram_alert_ap_online')) return;

    const downtimeStr = formatDowntime(downtimeMs);

    const baseMessage = [
        `🟢 <b>Access Point Restored</b>`,
        ``,
        `<b>AP Name:</b> ${escapeHtml(ap.name) || 'Unknown AP'}`,
        ap.mac ? `<b>MAC:</b> ${escapeHtml(ap.mac)}` : null,
        `<b>Downtime:</b> ${downtimeStr}`,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `✅ AP is back online.`
    ].filter(Boolean).join('\n');

    const aiContext = {
        name: ap.name,
        mac: ap.mac,
        downtime: downtimeStr
    };

    const message = await appendAiSection(baseMessage, 'ap_online', aiContext);
    return sendMessage(message);
}

/**
 * Network segment returned 0 devices on scan.
 */
async function sendSegmentOffline(segment, expectedDevices, hostsFound) {
    if (!isEnabled()) return;
    const settings = getSettings();
    if (!isEventEnabled(settings, 'telegram_alert_segment_offline')) return;

    const baseMessage = [
        `🔴 <b>Network Segment Unreachable</b>`,
        ``,
        `<b>Segment:</b> ${escapeHtml(segment.name)}`,
        `<b>Subnet:</b> ${escapeHtml(segment.cidr)}`,
        `<b>Devices Expected:</b> ${expectedDevices}`,
        `<b>Devices Found:</b> ${hostsFound || 0}`,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ Segment returned 0 devices on scan.`,
        `This may indicate a switch, router, or VLAN failure. Investigate immediately.`
    ].join('\n');

    const aiContext = {
        segment_name: segment.name,
        segment_cidr: segment.cidr,
        expected_devices: expectedDevices,
        current_time: formatTimestamp()
    };

    const message = await appendAiSection(baseMessage, 'segment_offline', aiContext);
    return sendMessage(message);
}

/**
 * Send a test notification to verify configuration.
 */
async function sendTestMessage() {
    const message = [
        `✅ <b>NetAIQ Test Notification</b>`,
        ``,
        `Your Telegram alerts are configured correctly.`,
        `<b>Time:</b> ${formatTimestamp()}`
    ].join('\n');

    return sendMessage(message);
}

/**
 * Send a test notification using explicit credentials, bypassing the DB and enabled check.
 * Used by the settings test button so users can test without saving first.
 */
async function sendTestMessageDirect(token, chatId) {
    try {
        validateBotToken(token);
        validateChatId(String(chatId).trim());
    } catch (err) {
        return { ok: false, description: err.message };
    }

    const message = [
        `✅ <b>NetAIQ Test Notification</b>`,
        ``,
        `Your Telegram alerts are configured correctly.`,
        `<b>Time:</b> ${formatTimestamp()}`
    ].join('\n');

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: String(chatId).trim(), text: message, parse_mode: 'HTML' }),
            signal: AbortSignal.timeout(10000)
        });
        return await response.json();
    } catch (err) {
        return { ok: false, description: err.message };
    }
}

module.exports = {
    getSettings,
    isEnabled,
    sendMessage,
    sendTestMessage,
    sendTestMessageDirect,
    sendCriticalDeviceOffline,
    sendCriticalDeviceOnline,
    sendApOffline,
    sendApOnline,
    sendSegmentOffline,
    formatDowntime
};
