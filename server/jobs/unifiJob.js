const cron = require('node-cron');
const db = require('../db/database');
const unifiService = require('../services/unifiService');

let currentTask = null;

module.exports = function (fastify) {
    // Clear any existing job (for when settings change)
    if (currentTask) {
        currentTask.stop();
    }

    const getInterval = () => {
        const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('unifi_interval_ms');
        return parseInt(setting?.value || '300000', 10);
    };

    const msToCron = (ms) => {
        if (ms <= 60000) return '* * * * *'; // 1m
        if (ms <= 300000) return '*/5 * * * *'; // 5m
        if (ms <= 900000) return '*/15 * * * *'; // 15m
        return '*/5 * * * *';
    };

    const intervalMs = getInterval();
    const cronExpression = msToCron(intervalMs);

    fastify.log.info(`Registering unifiJob with cron: ${cronExpression}`);

    currentTask = cron.schedule(cronExpression, async () => {
        fastify.log.info('Running scheduled UniFi cache job...');
        try {
            // Background fetching to keep cache warm
            await unifiService.getClients();
            await unifiService.getDevices();
            await unifiService.getSiteHealth();
        } catch (err) {
            fastify.log.error('UniFi schedule task error:', err.message);
        }
    });
};
