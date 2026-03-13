const cron = require('node-cron');
const db = require('../db/database');
const { scanSegment } = require('../services/scanService');

let currentTask = null;

module.exports = function (fastify) {
    // Clear any existing job (for when settings change)
    if (currentTask) {
        currentTask.stop();
    }

    // Segment scans are heavy, so we run them less frequently than simple pings.
    // We base it on ping_interval but force a minimum of 5 minutes.
    const getInterval = () => {
        const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('ping_interval_ms');
        return parseInt(setting?.value || '300000', 10);
    };

    const msToCron = (ms) => {
        if (ms <= 300000) return '*/5 * * * *'; // 5m
        if (ms <= 600000) return '*/10 * * * *'; // 10m
        if (ms <= 900000) return '*/15 * * * *'; // 15m
        return '*/30 * * * *'; // 30m
    };

    const intervalMs = getInterval();
    const cronExpression = msToCron(intervalMs);

    fastify.log.info(`Registering scanJob with cron: ${cronExpression}`);

    currentTask = cron.schedule(cronExpression, async () => {
        fastify.log.info('Running scheduled segment scan job...');

        const segments = db.prepare('SELECT id FROM segments').all();

        for (const seg of segments) {
            try {
                fastify.log.info(`Background scanning segment ${seg.id}...`);
                await scanSegment(seg.id, fastify);
            } catch (err) {
                // Ignore if already running, else log
                if (err.message !== 'A scan is already in progress.') {
                    fastify.log.error(`Segment ${seg.id} scheduled scan error: ${err.message}`);
                }
            }
        }
        fastify.log.info(`Segment scan job completed for ${segments.length} segments.`);
    });
};
