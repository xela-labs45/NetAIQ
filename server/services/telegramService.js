const db = require('../db/database');
const { formatInUserTimezone, normalizeDate } = require('../utils/dateFormatter');

function escapeHtml(str) {
    if (!str) return str;
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
        device.last_seen ? `<b>Last Seen:</b> ${device.last_seen}` : null,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ This device is marked as critical.`,
        `Check the network immediately.`
    ].filter(Boolean).join('\n');

    const aiContext = {
        hostname: device.hostname,
        ip_address: device.ip_address,
        mac_address: device.mac_address,
        segment_name: segmentName,
        segment_cidr: segmentCidr,
        last_seen: device.last_seen,
        minutes_offline: device.last_seen ? Math.round((Date.now() - normalizeDate(device.last_seen).getTime()) / 60000) : null
    };

    const message = await appendAiSection(baseMessage, 'critical_device_offline', aiContext);
    return sendMessage(message);
}

/**
 * Critical device came back online.
 */
async function sendCriticalDeviceOnline(device, segmentName, downtimeMs) {
    if (!isEnabled()) return;

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

    const aiContext = {
        hostname: device.hostname,
        ip_address: device.ip_address,
        segment_name: segmentName,
        downtime: downtimeStr
    };

    const message = await appendAiSection(baseMessage, 'critical_device_online', aiContext);
    return sendMessage(message);
}

/**
 * Access Point went offline.
 */
async function sendApOffline(ap) {
    if (!isEnabled()) return;

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
        `✅ <b>NetMon Test Notification</b>`,
        ``,
        `Your Telegram alerts are configured correctly.`,
        `<b>Time:</b> ${formatTimestamp()}`
    ].join('\n');

    return sendMessage(message);
}

module.exports = {
    getSettings,
    isEnabled,
    sendMessage,
    sendTestMessage,
    sendCriticalDeviceOffline,
    sendCriticalDeviceOnline,
    sendApOffline,
    sendApOnline,
    sendSegmentOffline,
    formatDowntime
};
