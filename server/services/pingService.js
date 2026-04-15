const ping = require('ping');
const db = require('../db/database');
const alertService = require('./alertService');
const telegramService = require('./telegramService');
const escalatingPollManager = require('./EscalatingPollManager');

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
        // Device went down
        const severity = device.is_critical ? 'critical' : 'warning';
        await alertService.createAlert({
            device_id: device.id,
            alert_type: 'device_down',
            message: `Device ${device.hostname || device.ip_address} is offline.`,
            severity,
            fastify
        });

        // Telegram: only for critical devices
        if (device.is_critical) {
            try {
                const segment = device.segment_id
                    ? db.prepare('SELECT name FROM segments WHERE id = ?').get(device.segment_id)
                    : null;
                const lastPingTime = db.prepare(
                    "SELECT timestamp FROM ping_history WHERE device_id = ? AND status = 'up' ORDER BY timestamp DESC LIMIT 1"
                ).get(device.id);
                const enrichedDevice = {
                    ...device,
                    last_seen: lastPingTime?.timestamp || null
                };
                telegramService.sendCriticalDeviceOffline(enrichedDevice, segment?.name || null);
            } catch (err) {
                console.error('Telegram critical-offline error (non-blocking):', err.message);
            }
            
            // Start escalating poll
            if (fastify) {
                escalatingPollManager.startEscalation(device, fastify);
            }
        }
    } else if (!wasUp && isUp && lastPing) {
        // Device came back up
        await alertService.createAlert({
            device_id: device.id,
            alert_type: 'device_up',
            message: `Device ${device.hostname || device.ip_address} is back online.`,
            severity: 'info',
            fastify
        });

        // Telegram: only for critical devices
        if (device.is_critical) {
            try {
                const segment = device.segment_id
                    ? db.prepare('SELECT name FROM segments WHERE id = ?').get(device.segment_id)
                    : null;
                // Calculate downtime: find the first DOWN ping in the current sequence
                // 1. Find the last 'up' ping that occurred BEFORE the current one
                const lastBeforeOutage = db.prepare(`
                    SELECT timestamp FROM ping_history 
                    WHERE device_id = ? AND status = 'up' AND timestamp < (
                        SELECT MAX(timestamp) FROM ping_history WHERE device_id = ? AND status = 'up'
                    )
                    ORDER BY timestamp DESC LIMIT 1
                `).get(device.id, device.id);

                // 2. Find the earliest 'down' ping AFTER that last 'up' (or from the beginning if no previous 'up')
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
            
            // Stop escalating poll
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
