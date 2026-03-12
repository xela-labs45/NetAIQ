const cron = require('node-cron');
const db = require('../db/database');
const { pingDevice } = require('../services/pingService');
const pLimit = require('p-limit');

let currentTask = null;

module.exports = function (fastify) {
    // Clear any existing job (for when settings change)
    if (currentTask) {
        currentTask.stop();
    }

    const getInterval = () => {
        const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('ping_interval_ms');
        return parseInt(setting?.value || '60000', 10);
    };

    const msToCron = (ms) => {
        if (ms <= 30000) return '*/30 * * * * *'; // 30s
        if (ms <= 60000) return '* * * * *'; // 1m
        if (ms <= 120000) return '*/2 * * * *'; // 2m
        if (ms <= 300000) return '*/5 * * * *'; // 5m
        return '* * * * *';
    };

    const intervalMs = getInterval();
    const cronExpression = msToCron(intervalMs);

    fastify.log.info(`Registering pingJob with cron: ${cronExpression}`);

    currentTask = cron.schedule(cronExpression, async () => {
        fastify.log.info('Running scheduled ping job...');
        const devices = db.prepare('SELECT * FROM devices').all();

        // Concurrency limit to avoid overwhelming network
        const limit = pLimit(10);

        const tasks = devices.map(device => limit(() => pingDevice(device, fastify)));

        await Promise.all(tasks);
        fastify.log.info(`Ping job completed for ${devices.length} devices.`);
    });
};
