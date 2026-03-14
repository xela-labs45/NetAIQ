const cron = require('node-cron');
const db = require('../db/database');
const unifiService = require('../services/unifiService');
const alertService = require('../services/alertService');

let currentTask = null;
let previousDisconnected = 0;

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
            const wlan = await unifiService.getWlanHealth();

            if (wlan) {
                // AP went offline
                if (wlan.num_disconnected > previousDisconnected) {
                    const newOffline = wlan.num_disconnected - previousDisconnected;
                    await alertService.createAlert(
                        null,
                        'ap_disconnected',
                        `${newOffline} access point(s) disconnected. ${wlan.num_disconnected} of ${wlan.num_ap} APs offline.`,
                        'critical'
                    );
                    await alertService.sendEmailAlert({
                        type: 'ap_disconnected',
                        message: `CRITICAL: ${wlan.num_disconnected} AP(s) offline`,
                        severity: 'critical'
                    });
                    fastify.io.emit('alert:new', {
                        type: 'ap_disconnected',
                        severity: 'critical',
                        message: `${wlan.num_disconnected} AP(s) disconnected`
                    });
                }

                // AP came back online
                if (wlan.num_disconnected < previousDisconnected) {
                    await alertService.createAlert(
                        null,
                        'ap_reconnected',
                        `Access point(s) reconnected. All ${wlan.num_ap} APs now online.`,
                        'info'
                    );
                    fastify.io.emit('alert:new', {
                        type: 'ap_reconnected',
                        severity: 'info',
                        message: 'All APs back online'
                    });
                }

                previousDisconnected = wlan.num_disconnected;
            }
        } catch (err) {
            fastify.log.error('UniFi schedule task error:', err.message);
        }
    });
};
