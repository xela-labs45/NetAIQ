const cron = require('node-cron');
const db = require('../db/database');
const { pingDevice } = require('../services/pingService');
const pLimit = require('p-limit');

let currentTask = null;
let cycleCount = 0;

module.exports = function (fastify) {
    // Clear any existing job (for when settings change)
    if (currentTask) {
        currentTask.stop();
        cycleCount = 0;
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

    /**
     * Determine if a device should be pinged on this cycle based on priority:
     *   - Critical devices (is_critical = 1): every cycle
     *   - Devices last seen DOWN: every cycle (detect recovery quickly)
     *   - Stable UP devices (latency < 100ms): every 3rd cycle
     *   - All other devices: every 2nd cycle
     */
    function shouldPingThisCycle(device) {
        // P0: Critical — always ping
        if (device.is_critical === 1) return true;

        // Check last ping status from ping_history
        const lastPing = db.prepare(
            'SELECT status, latency_ms FROM ping_history WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1'
        ).get(device.id);

        // P1: Last ping was DOWN or no history — always ping
        if (!lastPing || lastPing.status === 'down' || lastPing.status === 'timeout') return true;

        // P3: Stable UP with low latency — every 3rd cycle
        if (lastPing.status === 'up' && lastPing.latency_ms != null && lastPing.latency_ms < 100) {
            return cycleCount % 3 === 0;
        }

        // P2: Everything else — every 2nd cycle
        return cycleCount % 2 === 0;
    }

    const intervalMs = getInterval();
    const cronExpression = msToCron(intervalMs);

    fastify.log.info(`Registering smart pingJob with cron: ${cronExpression}`);

    currentTask = cron.schedule(cronExpression, async () => {
        cycleCount++;
        const allDevices = db.prepare('SELECT * FROM devices').all();

        // Filter devices based on priority for this cycle
        const devicesToPing = allDevices.filter(d => shouldPingThisCycle(d));
        const skipped = allDevices.length - devicesToPing.length;

        fastify.log.info(`Ping cycle #${cycleCount}: ${devicesToPing.length}/${allDevices.length} devices (${skipped} skipped as stable)`);

        // Concurrency limit to avoid overwhelming network
        const limit = pLimit(10);

        const tasks = devicesToPing.map(device => limit(async () => {
            let retries = 2;
            while (retries >= 0) {
                try {
                    await pingDevice(device, fastify);
                    return; // Success, exit retry loop
                } catch (err) {
                    if (retries === 0) {
                        fastify.log.error(`Device ${device.hostname || device.ip_address} ping failed after retries: ${err.message}`);
                    } else {
                        fastify.log.warn(`Device ${device.hostname || device.ip_address} ping failed, retrying... (${retries} left)`);
                        // Wait 1s before retry
                        await new Promise(res => setTimeout(res, 1000));
                    }
                    retries--;
                }
            }
        }));

        // Use allSettled to ensure we wait for all devices even if some have terminal errors
        await Promise.allSettled(tasks);
        fastify.log.info(`Ping cycle #${cycleCount} completed for ${devicesToPing.length} devices.`);
    });
};
