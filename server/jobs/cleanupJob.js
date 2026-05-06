const cron = require('node-cron');
const db = require('../db/database');
const settingsService = require('../services/settingsService');
const { toSqliteTimestamp } = require('../utils/dateFormatter');

function getSetting(key, defaultValue) {
    const val = settingsService.get(key);
    return val ? parseInt(val, 10) : defaultValue;
}

function startPingHistoryCleanup(log) {
    cron.schedule('0 2 * * *', () => {
        const retentionDays = getSetting('ping_history_retention_days', 90);
        const cutoffDate = toSqliteTimestamp(new Date(Date.now() - retentionDays * 86400000));

        try {
            const deleteOld = db.transaction(() => {
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
            log.info(`Ping history cleanup: deleted ${deleted} rows older than ${retentionDays} days (cutoff: ${cutoffDate})`);
        } catch (err) {
            log.error(`Ping history cleanup error: ${err.message}`);
        }
    });

    log.info('Cleanup job registered: ping_history — daily at 2:00 AM');
}

function startAlertHistoryCleanup(log) {
    cron.schedule('0 3 * * 0', () => {
        const retentionDays = getSetting('alert_retention_days', 180);
        const cutoffDate = toSqliteTimestamp(new Date(Date.now() - retentionDays * 86400000));

        try {
            const deleteOld = db.transaction(() => {
                const info = db.prepare(`
                    DELETE FROM alerts
                    WHERE created_at < ?
                      AND NOT (is_read = 0 AND severity = 'critical')
                `).run(cutoffDate);
                return info.changes;
            });

            const deleted = deleteOld();
            log.info(`Alert history cleanup: deleted ${deleted} alerts older than ${retentionDays} days (cutoff: ${cutoffDate})`);
        } catch (err) {
            log.error(`Alert history cleanup error: ${err.message}`);
        }
    });

    log.info('Cleanup job registered: alerts — weekly Sunday at 3:00 AM');
}

function startCleanupJobs(fastify) {
    const log = fastify?.log ?? console;
    startPingHistoryCleanup(log);
    startAlertHistoryCleanup(log);
}

module.exports = { startCleanupJobs };
