const cron = require('node-cron');
const db = require('../db/database');
const settingsService = require('../services/settingsService');
const { toSqliteTimestamp } = require('../utils/dateFormatter');

function getSetting(key, defaultValue) {
    const val = settingsService.get(key);
    return val ? parseInt(val, 10) : defaultValue;
}

function formatTimestamp() {
    return new Date().toISOString();
}

/**
 * Ping History Cleanup — daily at 2:00 AM
 * Deletes ping_history records older than the configured retention period.
 * Protects rows linked to unresolved critical alerts.
 */
function startPingHistoryCleanup() {
    // Daily at 2:00 AM
    cron.schedule('0 2 * * *', () => {
        const retentionDays = getSetting('ping_history_retention_days', 90);
        const cutoffDate = toSqliteTimestamp(new Date(Date.now() - retentionDays * 86400000));

        try {
            const deleteOld = db.transaction(() => {
                // Delete old ping_history rows, but protect any device that has
                // an unresolved critical alert
                const info = db.prepare(`
                    DELETE FROM ping_history
                    WHERE timestamp < ?
                      AND device_id NOT IN (
                        SELECT DISTINCT device_id FROM alerts
                        WHERE is_read = 0 AND severity = 'critical'
                      )
                `).run(cutoffDate);

                return info.changes;
            });

            const deleted = deleteOld();
            console.log(`[${formatTimestamp()}] Ping history cleanup: deleted ${deleted} rows older than ${retentionDays} days (cutoff: ${cutoffDate})`);
        } catch (err) {
            console.error(`[${formatTimestamp()}] Ping history cleanup error:`, err.message);
        }
    });

    console.log('Cleanup job registered: ping_history — daily at 2:00 AM');
}

/**
 * Alert History Cleanup — weekly on Sunday at 3:00 AM
 * Deletes alert records older than the configured retention period.
 * Protects unresolved critical alerts regardless of age.
 */
function startAlertHistoryCleanup() {
    // Every Sunday at 3:00 AM
    cron.schedule('0 3 * * 0', () => {
        const retentionDays = getSetting('alert_retention_days', 180);
        const cutoffDate = toSqliteTimestamp(new Date(Date.now() - retentionDays * 86400000));

        try {
            const deleteOld = db.transaction(() => {
                // Delete old alerts, but never delete unresolved critical alerts
                const info = db.prepare(`
                    DELETE FROM alerts
                    WHERE created_at < ?
                      AND NOT (is_read = 0 AND severity = 'critical')
                `).run(cutoffDate);

                return info.changes;
            });

            const deleted = deleteOld();
            console.log(`[${formatTimestamp()}] Alert history cleanup: deleted ${deleted} alerts older than ${retentionDays} days (cutoff: ${cutoffDate})`);
        } catch (err) {
            console.error(`[${formatTimestamp()}] Alert history cleanup error:`, err.message);
        }
    });

    console.log('Cleanup job registered: alerts — weekly Sunday at 3:00 AM');
}

/**
 * Start all cleanup jobs
 */
function startCleanupJobs() {
    startPingHistoryCleanup();
    startAlertHistoryCleanup();
}

module.exports = { startCleanupJobs };
