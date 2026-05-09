const ping = require('ping');
const db = require('../db/database');
const alertService = require('./alertService');
const telegramService = require('./telegramService');
const escalatingPollManager = require('./EscalatingPollManager');
const graceTracker = require('./offlineGraceTracker');

async function performPing(device) {
    try {
        const res = await ping.promise.probe(device.ip_address, {
            timeout: 2,
        });

        return {
            status: res.alive ? 'up' : 'down',
            latency_ms: res.alive ? parseFloat(res.time) : null,
            packet_loss: res.packetLoss || (res.alive ? 0 : 100)
        };
    } catch (err) {
        console.error(`Ping failed for ${device.ip_address}:`, err);
        return {
            status: 'down',
            latency_ms: null,
            packet_loss: 100
        };
    }
}

async function checkAndFireOfflineNotifications(device, entityKey, fastify) {
    const shouldEmail = graceTracker.shouldNotify(entityKey, 'email');
    const shouldTelegram = graceTracker.shouldNotify(entityKey, 'telegram');
    if (!shouldEmail && !shouldTelegram) return;

    const settings = db.prepare('SELECT key, value FROM settings').all()
        .reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});

    if (shouldEmail) {
        graceTracker.markNotified(entityKey, 'email');
        if (settings.alert_on_critical_offline === '1') {
            await alertService.sendEmailAlert({
                alert_type: 'device_down',
                severity: 'critical',
                message: `Device ${device.hostname || device.ip_address} is offline.`
            });
        }
    }

    if (shouldTelegram) {
        graceTracker.markNotified(entityKey, 'telegram');
        try {
            const segment = device.segment_id
                ? db.prepare('SELECT name FROM segments WHERE id = ?').get(device.segment_id)
                : null;
            const lastPingTime = db.prepare(
                "SELECT timestamp FROM ping_history WHERE device_id = ? AND status = 'up' ORDER BY timestamp DESC LIMIT 1"
            ).get(device.id);
            const enrichedDevice = { ...device, last_seen: lastPingTime?.timestamp || null };
            telegramService.sendCriticalDeviceOffline(enrichedDevice, segment?.name || null);
        } catch (err) {
            console.error('Telegram critical-offline error (non-blocking):', err.message);
        }
    }
}

async function pingDevice(device, fastify) {
    const result = await performPing(device);

    // Get last ping status to compare
    const lastPing = db.prepare('SELECT status FROM ping_history WHERE device_id = ? ORDER BY timestamp DESC LIMIT 1').get(device.id);
    const wasUp = lastPing ? lastPing.status === 'up' : false;
    const isUp = result.status === 'up';

    // Save history
    db.prepare(`
    INSERT INTO ping_history (device_id, status, latency_ms, packet_loss)
    VALUES (?, ?, ?, ?)
  `).run(device.id, result.status, result.latency_ms, result.packet_loss);

    // Check alert conditions
    if (wasUp && !isUp) {
        // Device went down — create DB record immediately for history
        const severity = device.is_critical ? 'critical' : 'warning';
        await alertService.createAlert({
            device_id: device.id,
            alert_type: 'device_down',
            message: `Device ${device.hostname || device.ip_address} is offline.`,
            severity,
            fastify,
            suppressEmail: true  // email handled separately with grace period
        });

        if (device.is_critical) {
            const entityKey = `device:${device.id}`;
            graceTracker.markOffline(entityKey);
            // Fire notifications now if grace period is 0, otherwise defer
            await checkAndFireOfflineNotifications(device, entityKey, fastify);
            // Start escalating poll immediately for faster recovery detection
            if (fastify) {
                escalatingPollManager.startEscalation(device, fastify);
            }
        }
    } else if (!wasUp && !isUp) {
        // Device still offline — check if grace period has elapsed for pending notifications
        if (device.is_critical) {
            const entityKey = `device:${device.id}`;
            if (graceTracker.isTracked(entityKey)) {
                await checkAndFireOfflineNotifications(device, entityKey, fastify);
            }
        }
    } else if (!wasUp && isUp && lastPing) {
        // Device came back up
        const entityKey = device.is_critical ? `device:${device.id}` : null;
        const emailSent = entityKey ? graceTracker.wasNotified(entityKey, 'email') : false;
        const telegramSent = entityKey ? graceTracker.wasNotified(entityKey, 'telegram') : false;
        if (entityKey) graceTracker.markOnline(entityKey);

        // Create DB record; send email only if offline notification was sent
        await alertService.createAlert({
            device_id: device.id,
            alert_type: 'device_up',
            message: `Device ${device.hostname || device.ip_address} is back online.`,
            severity: 'info',
            fastify,
            suppressEmail: !emailSent
        });

        if (device.is_critical) {
            if (telegramSent) {
                try {
                    const segment = device.segment_id
                        ? db.prepare('SELECT name FROM segments WHERE id = ?').get(device.segment_id)
                        : null;
                    // Calculate downtime: find the first DOWN ping in the current sequence
                    const lastBeforeOutage = db.prepare(`
                        SELECT timestamp FROM ping_history
                        WHERE device_id = ? AND status = 'up' AND timestamp < (
                            SELECT MAX(timestamp) FROM ping_history WHERE device_id = ? AND status = 'up'
                        )
                        ORDER BY timestamp DESC LIMIT 1
                    `).get(device.id, device.id);

                    const outageStart = db.prepare(`
                        SELECT timestamp FROM ping_history
                        WHERE device_id = ? AND status = 'down'
                        ${lastBeforeOutage ? 'AND timestamp > ?' : ''}
                        ORDER BY timestamp ASC LIMIT 1
                    `).get(device.id, ...(lastBeforeOutage ? [lastBeforeOutage.timestamp] : []));

                    const downtimeMs = outageStart?.timestamp
                        ? Date.now() - new Date(outageStart.timestamp + 'Z').getTime()
                        : null;
                    telegramService.sendCriticalDeviceOnline(device, segment?.name || null, downtimeMs);
                } catch (err) {
                    console.error('Telegram critical-online error (non-blocking):', err.message);
                }
            }

            // Stop escalating poll regardless of whether notifications were sent
            escalatingPollManager.stopEscalation(device.id, 'device came back online');
        }
    } else if (isUp && result.latency_ms > 200) {
        // High latency
        await alertService.createAlert({
            device_id: device.id,
            alert_type: 'high_latency',
            message: `Device ${device.hostname || device.ip_address} has high latency (${result.latency_ms}ms).`,
            severity: 'warning',
            fastify
        });
    }

    // Emit event
    if (fastify && fastify.io) {
        fastify.io.emit('device:status', {
            device_id: device.id,
            ip: device.ip_address,
            status: result.status,
            latency_ms: result.latency_ms,
            timestamp: new Date().toISOString()
        });
    }

    return result;
}

module.exports = {
    pingDevice,
    performPing
};
