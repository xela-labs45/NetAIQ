const db = require('../db/database');
const {
    safeArpScan,
    safeArpScanAll,
    isArpScanRunning
} = require('../services/discoveryService');
const { identifyDiscoveredDevice } = require('../services/aiService');

module.exports = async function (fastify, opts) {
    // Protect all routes
    fastify.addHook('preValidation', fastify.authenticate);

    fastify.get('/discovered', async (request, reply) => {
        const { segment_id, is_wired, ai_identified, limit = 200, offset = 0 } = request.query;

        let query = `
      SELECT dd.*, 
             aid.device_type_suggestion,
             aid.manufacturer,
             aid.os_guess,
             aid.confidence,
             aid.reasoning,
             aid.suggested_name,
             aid.provider as ai_provider,
             s.name as segment_name,
             s.color as segment_color,
             (SELECT 1 FROM devices d WHERE d.mac_address = dd.mac_address LIMIT 1) as is_registered
      FROM discovered_devices dd
      LEFT JOIN ai_device_identifications aid
        ON aid.mac_address = dd.mac_address
      LEFT JOIN segments s ON s.id = dd.segment_id
      WHERE 1=1
    `;
        const params = [];

        if (segment_id) {
            query += ` AND dd.segment_id = ?`;
            params.push(segment_id);
        }
        if (is_wired !== undefined && is_wired !== '') {
            query += ` AND dd.is_wired = ?`;
            params.push(is_wired === 'true' || is_wired === '1' ? 1 : 0);
        }
        if (ai_identified !== undefined && ai_identified !== '') {
            query += ` AND dd.ai_identified = ?`;
            params.push(ai_identified === 'true' || ai_identified === '1' ? 1 : 0);
        }

        query += ` ORDER BY dd.last_seen DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit, 10), parseInt(offset, 10));

        const devices = db.prepare(query).all(...params);
        return reply.send({ devices });
    });

    fastify.get('/discovered/stats', async (request, reply) => {
        const total = db.prepare('SELECT count(*) as count FROM discovered_devices').get()?.count || 0;
        const identified = db.prepare('SELECT count(*) as count FROM discovered_devices WHERE ai_identified = 1').get()?.count || 0;
        const wired = db.prepare('SELECT count(*) as count FROM discovered_devices WHERE is_wired = 1').get()?.count || 0;
        const wireless = db.prepare('SELECT count(*) as count FROM discovered_devices WHERE is_wired = 0').get()?.count || 0;

        const by_segment = db.prepare(`
      SELECT s.name as segment_name, count(*) as count
      FROM discovered_devices dd
      LEFT JOIN segments s ON s.id = dd.segment_id
      GROUP BY s.id
    `).all();

        const last_harvest = db.prepare('SELECT last_seen FROM discovered_devices ORDER BY last_seen DESC LIMIT 1').get()?.last_seen || null;

        return reply.send({
            total,
            identified,
            wired,
            wireless,
            by_segment,
            last_harvest
        });
    });

    fastify.post('/arp-scan/all', async (request, reply) => {
        try {
            // Run async
            safeArpScanAll(fastify).catch(err => {
                fastify.log.error(`ARP Scan All failed: ${err.message}`);
            });
            return reply.code(202).send({ started: true });
        } catch (err) {
            return reply.code(409).send({ error: true, message: err.message });
        }
    });

    fastify.post('/arp-scan/:segmentId', async (request, reply) => {
        try {
            const { segmentId } = request.params;
            // Run async
            safeArpScan(segmentId, fastify).catch(err => {
                fastify.log.error(`ARP Scan on segment ${segmentId} failed: ${err.message}`);
            });
            return reply.code(202).send({ started: true, segment_id: segmentId });
        } catch (err) {
            return reply.code(409).send({ error: true, message: err.message });
        }
    });

    fastify.get('/arp-scan/status', async (request, reply) => {
        return reply.send({ running: isArpScanRunning() });
    });

    fastify.post('/identify-all', async (request, reply) => {
        // Identify all unidentified devices
        const unidentified = db.prepare(`
      SELECT * FROM discovered_devices WHERE ai_identified = 0
    `).all();

        if (unidentified.length === 0) {
            return reply.send({ started: false, message: 'No unidentified devices found.' });
        }

        // Run async sequential identification
        setImmediate(async () => {
            let count = 0;
            for (const device of unidentified) {
                try {
                    if (fastify.io) {
                        fastify.io.emit('discovery:identify_progress', {
                            current: count + 1,
                            total: unidentified.length,
                            mac: device.mac_address
                        });
                    }

                    // Ensure it exists in devices table as requested by spec
                    // For discovered_devices not yet in devices table, auto-create a minimal entry
                    const exists = db.prepare('SELECT id FROM devices WHERE mac_address = ?').get(device.mac_address);
                    if (!exists) {
                        // Must have IP to insert into devices
                        if (device.last_ip) {
                            // Ignore unique constraint error if IP already used by another device
                            try {
                                db.prepare(`
                    INSERT INTO devices (hostname, ip_address, mac_address, device_type, is_critical)
                    VALUES (?, ?, ?, 'other', 0)
                `).run(device.hostname || null, device.last_ip, device.mac_address);
                            } catch (e) {
                                // Probably IP exists for a different MAC. Just skip creating in devices table
                                // and let the identifyDiscoveredDevice handle it natively via discovered_devices
                            }
                        }
                    }

                    // Now identify
                    await identifyDiscoveredDevice(device.mac_address);
                    count++;

                    // Wait 3 seconds between calls to not hammer the AI API
                    await new Promise(r => setTimeout(r, 3000));
                } catch (err) {
                    fastify.log.error(`Failed to identify ${device.mac_address}: ${err.message}`);
                }
            }

            if (fastify.io) {
                fastify.io.emit('discovery:identify_complete', {
                    identified: count,
                    total: unidentified.length
                });
            }
        });

        return reply.code(202).send({ started: true, total: unidentified.length });
    });
};
