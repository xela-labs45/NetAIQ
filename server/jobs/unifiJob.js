const cron = require('node-cron');
const db = require('../db/database');
const unifiService = require('../services/unifiService');
const alertService = require('../services/alertService');
const telegramService = require('../services/telegramService');
const { harvestUnifiClients } = require('../services/discoveryService');

let currentTask = null;
let previousDisconnected = 0;

// Per-AP state tracking for Telegram and email notifications
// Map<mac, {
//   state: 'connected'|'disconnected',
//   since: number,
//   name: string,
//   telegramNotifiedAt: number|null,
//   emailNotifiedAt: number|null,
//   skipNotify: boolean  // true for APs that were already offline at server start
// }>
let apStateMap = new Map();

function getGraceMs(channel) {
    const key = channel === 'email' ? 'email_offline_grace_minutes' : 'telegram_offline_grace_minutes';
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return Math.max(0, parseInt(row?.value || '0', 10)) * 60 * 1000;
}

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
                // ── Aggregate-based DB alerts and socket events (no email — handled per-AP below) ──

                // AP count went up (more disconnected)
                if (wlan.num_disconnected > previousDisconnected) {
                    const newOffline = wlan.num_disconnected - previousDisconnected;
                    await alertService.createAlert({
                        device_id: null,
                        alert_type: 'ap_disconnected',
                        message: `${newOffline} access point(s) disconnected. ${wlan.num_disconnected} of ${wlan.num_ap} APs offline.`,
                        severity: 'critical',
                        fastify,
                        suppressEmail: true  // per-AP tracking handles email with grace period
                    });
                    fastify.io.emit('alert:new', {
                        type: 'ap_disconnected',
                        severity: 'critical',
                        message: `${wlan.num_disconnected} AP(s) disconnected`
                    });
                }

                // AP count went down (more connected)
                if (wlan.num_disconnected < previousDisconnected) {
                    await alertService.createAlert({
                        device_id: null,
                        alert_type: 'ap_reconnected',
                        message: `Access point(s) reconnected. All ${wlan.num_ap} APs now online.`,
                        severity: 'info',
                        fastify,
                        suppressEmail: true  // per-AP tracking handles email with grace period
                    });
                    fastify.io.emit('alert:new', {
                        type: 'ap_reconnected',
                        severity: 'info',
                        message: 'All APs back online'
                    });
                }

                previousDisconnected = wlan.num_disconnected;
            }

            // ── Per-AP Telegram and email notifications with grace period ────────────────────────
            try {
                const devices = devicesData?.data || devicesData || [];
                const aps = Array.isArray(devices) ? devices.filter(d => d.type === 'uap') : [];

                if (aps.length > 0) {
                    const now = Date.now();

                    for (const ap of aps) {
                        const mac = (ap.mac || '').toLowerCase();
                        if (!mac) continue;

                        const isConnected = ap.state === 1;
                        const prevState = apStateMap.get(mac);

                        if (!prevState) {
                            // First time seeing this AP — initialize without alerting.
                            // APs already offline at server start get skipNotify to avoid
                            // spurious "been offline" alerts on startup.
                            apStateMap.set(mac, {
                                state: isConnected ? 'connected' : 'disconnected',
                                since: now,
                                name: ap.name || ap.hostname || mac,
                                telegramNotifiedAt: null,
                                emailNotifiedAt: null,
                                skipNotify: !isConnected
                            });
                            continue;
                        }

                        // State transition: connected → disconnected
                        if (prevState.state === 'connected' && !isConnected) {
                            fastify.log.warn(`AP ${ap.name || mac} went OFFLINE`);
                            apStateMap.set(mac, {
                                state: 'disconnected',
                                since: now,
                                name: ap.name || ap.hostname || mac,
                                telegramNotifiedAt: null,
                                emailNotifiedAt: null,
                                skipNotify: false
                            });
                            // Fall through to grace period check below
                        }

                        // Still disconnected or just went disconnected — check grace period
                        const currentState = apStateMap.get(mac);
                        if (currentState.state === 'disconnected' && !isConnected && !currentState.skipNotify) {
                            if (currentState.telegramNotifiedAt === null) {
                                const tgGraceMs = getGraceMs('telegram');
                                if (now - currentState.since >= tgGraceMs) {
                                    currentState.telegramNotifiedAt = now;
                                    telegramService.sendApOffline({
                                        name: currentState.name,
                                        mac,
                                        last_seen: ap.last_seen || null
                                    });
                                }
                            }

                            if (currentState.emailNotifiedAt === null) {
                                const emailGraceMs = getGraceMs('email');
                                if (now - currentState.since >= emailGraceMs) {
                                    currentState.emailNotifiedAt = now;
                                    const emailPref = db.prepare("SELECT value FROM settings WHERE key = 'email_alert_ap_offline'").get();
                                    if (emailPref?.value === '1') {
                                        alertService.sendEmailAlert({
                                            alert_type: 'ap_offline',
                                            message: `Access point "${currentState.name}" (${mac}) is offline.`,
                                            severity: 'critical'
                                        });
                                    }
                                }
                            }
                        }

                        // State transition: disconnected → connected
                        if (prevState.state === 'disconnected' && isConnected) {
                            fastify.log.info(`AP ${ap.name || mac} came back ONLINE`);
                            const telegramWasNotified = prevState.telegramNotifiedAt !== null;
                            const emailWasNotified = prevState.emailNotifiedAt !== null;
                            const downtimeMs = now - prevState.since;

                            apStateMap.set(mac, {
                                state: 'connected',
                                since: now,
                                name: ap.name || ap.hostname || mac,
                                telegramNotifiedAt: null,
                                emailNotifiedAt: null,
                                skipNotify: false
                            });

                            if (telegramWasNotified) {
                                telegramService.sendApOnline({
                                    name: prevState.name,
                                    mac
                                }, downtimeMs);
                            }
                            if (emailWasNotified) {
                                const emailPref = db.prepare("SELECT value FROM settings WHERE key = 'email_alert_ap_online'").get();
                                if (emailPref?.value === '1') {
                                    alertService.sendEmailAlert({
                                        alert_type: 'ap_online',
                                        message: `Access point "${prevState.name}" (${mac}) is back online.`,
                                        severity: 'info'
                                    });
                                }
                            }
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
