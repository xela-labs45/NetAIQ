const db = require('../db/database');

// CRUD wrapper for the `notification_state` table. Each tracker
// (offlineGraceTracker, scanJob segmentZeroTracker, unifiJob apStateMap)
// keeps its own in-memory Map and uses this store to survive restarts.
//
// `extra` is an opaque, tracker-specific blob persisted as JSON. Devices
// and segments don't use it; the UniFi AP tracker stores {state, name,
// skipNotify} there.

function loadByType(entityType) {
    try {
        const rows = db.prepare(`
            SELECT entity_key, since, email_notified_at, telegram_notified_at, extra_json
            FROM notification_state
            WHERE entity_type = ?
        `).all(entityType);

        return rows.map(row => {
            let extra = null;
            if (row.extra_json) {
                try { extra = JSON.parse(row.extra_json); }
                catch (err) {
                    console.warn(`notificationStateStore: malformed extra_json for ${entityType}/${row.entity_key}: ${err.message}`);
                }
            }
            return {
                entity_key: row.entity_key,
                since: row.since,
                email_notified_at: row.email_notified_at,
                telegram_notified_at: row.telegram_notified_at,
                extra
            };
        });
    } catch (err) {
        console.error(`notificationStateStore.loadByType(${entityType}) failed:`, err.message);
        return [];
    }
}

function upsert(entityType, entityKey, { since, emailNotifiedAt = null, telegramNotifiedAt = null, extra = null }) {
    try {
        const extraJson = extra == null ? null : JSON.stringify(extra);
        db.prepare(`
            INSERT INTO notification_state
                (entity_type, entity_key, since, email_notified_at, telegram_notified_at, extra_json)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_key) DO UPDATE SET
                since = excluded.since,
                email_notified_at = excluded.email_notified_at,
                telegram_notified_at = excluded.telegram_notified_at,
                extra_json = excluded.extra_json
        `).run(entityType, String(entityKey), since, emailNotifiedAt, telegramNotifiedAt, extraJson);
    } catch (err) {
        console.error(`notificationStateStore.upsert(${entityType}/${entityKey}) failed:`, err.message);
    }
}

function remove(entityType, entityKey) {
    try {
        db.prepare(`
            DELETE FROM notification_state
            WHERE entity_type = ? AND entity_key = ?
        `).run(entityType, String(entityKey));
    } catch (err) {
        console.error(`notificationStateStore.remove(${entityType}/${entityKey}) failed:`, err.message);
    }
}

module.exports = { loadByType, upsert, remove };
