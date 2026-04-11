const db = require('../db/database');

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
            })
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
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

// ─── Alert Formatters ────────────────────────────────────────────

/**
 * Critical device went offline.
 */
async function sendCriticalDeviceOffline(device, segmentName) {
    if (!isEnabled()) return;

    const message = [
        `🔴 <b>Critical Device Offline</b>`,
        ``,
        `<b>Device:</b> ${device.hostname || device.ip_address}`,
        `<b>IP:</b> ${device.ip_address}`,
        device.mac_address ? `<b>MAC:</b> ${device.mac_address}` : null,
        segmentName ? `<b>Segment:</b> ${segmentName}` : null,
        device.last_seen ? `<b>Last Seen:</b> ${device.last_seen}` : null,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ This device is marked as critical.`,
        `Check the network immediately.`
    ].filter(Boolean).join('\n');

    return sendMessage(message);
}

/**
 * Critical device came back online.
 */
async function sendCriticalDeviceOnline(device, segmentName, downtimeMs) {
    if (!isEnabled()) return;

    const message = [
        `🟢 <b>Critical Device Restored</b>`,
        ``,
        `<b>Device:</b> ${device.hostname || device.ip_address}`,
        `<b>IP:</b> ${device.ip_address}`,
        segmentName ? `<b>Segment:</b> ${segmentName}` : null,
        `<b>Downtime:</b> ${formatDowntime(downtimeMs)}`,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `✅ Device is back online.`
    ].filter(Boolean).join('\n');

    return sendMessage(message);
}

/**
 * Access Point went offline.
 */
async function sendApOffline(ap) {
    if (!isEnabled()) return;

    const message = [
        `🔴 <b>Access Point Offline</b>`,
        ``,
        `<b>AP Name:</b> ${ap.name || 'Unknown AP'}`,
        ap.mac ? `<b>MAC:</b> ${ap.mac}` : null,
        ap.last_seen ? `<b>Last Seen:</b> ${new Date(ap.last_seen * 1000).toISOString().replace('T', ' ').substring(0, 19)}` : null,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ Check UniFi and physical connection.`
    ].filter(Boolean).join('\n');

    return sendMessage(message);
}

/**
 * Access Point came back online.
 */
async function sendApOnline(ap, downtimeMs) {
    if (!isEnabled()) return;

    const message = [
        `🟢 <b>Access Point Restored</b>`,
        ``,
        `<b>AP Name:</b> ${ap.name || 'Unknown AP'}`,
        ap.mac ? `<b>MAC:</b> ${ap.mac}` : null,
        `<b>Downtime:</b> ${formatDowntime(downtimeMs)}`,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `✅ AP is back online.`
    ].filter(Boolean).join('\n');

    return sendMessage(message);
}

/**
 * Network segment returned 0 devices on scan.
 */
async function sendSegmentOffline(segment, expectedDevices, hostsFound) {
    if (!isEnabled()) return;

    const message = [
        `🔴 <b>Network Segment Unreachable</b>`,
        ``,
        `<b>Segment:</b> ${segment.name}`,
        `<b>Subnet:</b> ${segment.cidr}`,
        `<b>Devices Expected:</b> ${expectedDevices}`,
        `<b>Devices Found:</b> ${hostsFound || 0}`,
        `<b>Time:</b> ${formatTimestamp()}`,
        ``,
        `⚠️ Segment returned 0 devices on scan.`,
        `This may indicate a switch, router, or VLAN failure. Investigate immediately.`
    ].join('\n');

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
