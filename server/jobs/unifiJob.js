const cron = require('node-cron');
const db = require('../db/database');
const unifiService = require('../services/unifiService');
const alertService = require('../services/alertService');
const telegramService = require('../services/telegramService');
const { harvestUnifiClients } = require('../services/discoveryService');

let currentTask = null;
let previousDisconnected = 0;

// Per-AP state tracking for individual Telegram notifications
// Map<mac, { state: 'connected'|'disconnected', since: timestamp, name: string }>
let apStateMap = new Map();

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

            // Auto-harvest WiFi + historical devices to the permanent registry
            const harvested = await harvestUnifiClients();
            fastify.log.info(`Discovery: harvested ${harvested?.wifi || 0} WiFi, ${harvested?.wired || 0} wired, ${harvested?.historical || 0} historical`);

            const devicesData = await unifiService.getDevices();
            await unifiService.getSiteHealth();
            const wlan = await unifiService.getWlanHealth();

            if (wlan) {
                // ── Aggregate-based alerts (existing logic) ──────────────

                // AP went offline
                if (wlan.num_disconnected > previousDisconnected) {
                    const newOffline = wlan.num_disconnected - previousDisconnected;
                    await alertService.createAlert({
                        device_id: null,
                        alert_type: 'ap_disconnected',
                        message: `${newOffline} access point(s) disconnected. ${wlan.num_disconnected} of ${wlan.num_ap} APs offline.`,
                        severity: 'critical',
                        fastify
                    });
                    await alertService.sendEmailAlert({
                        alert_type: 'ap_disconnected',
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
                    await alertService.createAlert({
                        device_id: null,
                        alert_type: 'ap_reconnected',
                        message: `Access point(s) reconnected. All ${wlan.num_ap} APs now online.`,
                        severity: 'info',
                        fastify
                    });
                    fastify.io.emit('alert:new', {
                        type: 'ap_reconnected',
                        severity: 'info',
                        message: 'All APs back online'
                    });
                }

                previousDisconnected = wlan.num_disconnected;
            }

            // ── Per-AP Telegram notifications ────────────────────────
            try {
                const devices = devicesData?.data || devicesData || [];
                const aps = Array.isArray(devices) ? devices.filter(d => d.type === 'uap') : [];

                if (aps.length > 0) {
                    const currentMacs = new Set();

                    for (const ap of aps) {
                        const mac = (ap.mac || '').toLowerCase();
                        if (!mac) continue;
                        currentMacs.add(mac);

                        const isConnected = ap.state === 1;
                        const prevState = apStateMap.get(mac);

                        if (!prevState) {
                            // First time seeing this AP — initialize state without alerting
                            apStateMap.set(mac, {
                                state: isConnected ? 'connected' : 'disconnected',
                                since: Date.now(),
                                name: ap.name || ap.hostname || mac
                            });
                            continue;
                        }

                        // State transition: connected → disconnected
                        if (prevState.state === 'connected' && !isConnected) {
                            fastify.log.warn(`AP ${ap.name || mac} went OFFLINE`);
                            apStateMap.set(mac, {
                                state: 'disconnected',
                                since: Date.now(),
                                name: ap.name || ap.hostname || mac
                            });
                            telegramService.sendApOffline({
                                name: ap.name || ap.hostname || mac,
                                mac: mac,
                                last_seen: ap.last_seen || null
                            });
                        }

                        // State transition: disconnected → connected
                        if (prevState.state === 'disconnected' && isConnected) {
                            fastify.log.info(`AP ${ap.name || mac} came back ONLINE`);
                            const downtimeMs = Date.now() - prevState.since;
                            apStateMap.set(mac, {
                                state: 'connected',
                                since: Date.now(),
                                name: ap.name || ap.hostname || mac
                            });
                            telegramService.sendApOnline({
                                name: ap.name || ap.hostname || mac,
                                mac: mac
                            }, downtimeMs);
                        }
                    }
                }
            } catch (tgErr) {
                fastify.log.error('Telegram AP tracking error (non-blocking):', tgErr.message);
            }

        } catch (err) {
            fastify.log.error('UniFi schedule task error:', err.message);
        }
    });
};
