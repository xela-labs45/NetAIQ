const db = require('../db/database');
const store = require('./notificationStateStore');

// Map<entityKey, { since: number, telegramNotifiedAt: number|null, emailNotifiedAt: number|null }>
//
// entityKey is a prefixed string: `device:${id}` or `segment:${id}`. The
// prefix is the entity type used in `notification_state.entity_type`. The
// UniFi AP tracker (unifiJob.js) has a more complex state machine and keeps
// its own Map — it imports `getGraceMs` from here but not the rest.
const tracker = new Map();

// Types this tracker is responsible for.
const MANAGED_TYPES = ['device', 'segment'];

function entityTypeOf(entityKey) {
    const colonIdx = entityKey.indexOf(':');
    if (colonIdx <= 0) {
        throw new Error(`offlineGraceTracker: entityKey must be of the form 'type:id', got '${entityKey}'`);
    }
    return entityKey.slice(0, colonIdx);
}

// Rehydrate from DB on module load so notifications survive server restarts.
// better-sqlite3 + database.js initialise synchronously, so by the time this
// module is required the `notification_state` table is guaranteed to exist.
for (const type of MANAGED_TYPES) {
    for (const row of store.loadByType(type)) {
        tracker.set(`${type}:${row.entity_key}`, {
            since: row.since,
            emailNotifiedAt: row.email_notified_at,
            telegramNotifiedAt: row.telegram_notified_at
        });
    }
}

function persist(entityKey) {
    const state = tracker.get(entityKey);
    if (!state) return;
    const type = entityTypeOf(entityKey);
    const id = entityKey.slice(type.length + 1);
    store.upsert(type, id, {
        since: state.since,
        emailNotifiedAt: state.emailNotifiedAt,
        telegramNotifiedAt: state.telegramNotifiedAt,
        extra: null
    });
}

function getGraceMs(channel) {
    const key = channel === 'email' ? 'email_offline_grace_minutes' : 'telegram_offline_grace_minutes';
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    const minutes = parseInt(row?.value || '0', 10);
    return Math.max(0, minutes) * 60 * 1000;
}

function markOffline(entityKey) {
    if (!tracker.has(entityKey)) {
        tracker.set(entityKey, { since: Date.now(), emailNotifiedAt: null, telegramNotifiedAt: null });
        persist(entityKey);
    }
    return tracker.get(entityKey);
}

function markOnline(entityKey) {
    const state = tracker.get(entityKey);
    tracker.delete(entityKey);
    const type = entityTypeOf(entityKey);
    const id = entityKey.slice(type.length + 1);
    store.remove(type, id);
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
    persist(entityKey);
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
