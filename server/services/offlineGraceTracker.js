const db = require('../db/database');

// Map<entityKey, { since: number, telegramNotifiedAt: number|null, emailNotifiedAt: number|null }>
// entityKey format: `device:${id}`
const tracker = new Map();

function getGraceMs(channel) {
    const key = channel === 'email' ? 'email_offline_grace_minutes' : 'telegram_offline_grace_minutes';
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    const minutes = parseInt(row?.value || '0', 10);
    return Math.max(0, minutes) * 60 * 1000;
}

function markOffline(entityKey) {
    if (!tracker.has(entityKey)) {
        tracker.set(entityKey, { since: Date.now(), emailNotifiedAt: null, telegramNotifiedAt: null });
    }
    return tracker.get(entityKey);
}

function markOnline(entityKey) {
    const state = tracker.get(entityKey);
    tracker.delete(entityKey);
    return state;
}

function shouldNotify(entityKey, channel) {
    const state = tracker.get(entityKey);
    if (!state) return false;
    const notifiedField = channel === 'email' ? 'emailNotifiedAt' : 'telegramNotifiedAt';
    if (state[notifiedField] !== null) return false;
    return Date.now() - state.since >= getGraceMs(channel);
}

function markNotified(entityKey, channel) {
    const state = tracker.get(entityKey);
    if (!state) return;
    if (channel === 'email') state.emailNotifiedAt = Date.now();
    else state.telegramNotifiedAt = Date.now();
}

function wasNotified(entityKey, channel) {
    const state = tracker.get(entityKey);
    if (!state) return false;
    const notifiedField = channel === 'email' ? 'emailNotifiedAt' : 'telegramNotifiedAt';
    return state[notifiedField] !== null;
}

function isTracked(entityKey) {
    return tracker.has(entityKey);
}

module.exports = { markOffline, markOnline, shouldNotify, markNotified, wasNotified, isTracked, getGraceMs };
