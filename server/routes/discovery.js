const db = require('../db/database');
const { safeError } = require('../utils/dateFormatter');
const {
    checkDiscoveryCapability,
    arpScanL2Segment,
    isArpScanRunning,
    harvestUnifiClients,
    getMacTrackingStats,
    resetMacTrackingStats
} = require('../services/discoveryService');
const { identifyDiscoveredDevice } = require('../services/aiService');

// Concurrency lock for batch identification
let identificationRunning = false;

module.exports = async function (fastify, opts) {
    // Protect all routes
    fastify.addHook('preValidation', fastify.authenticate);

    // ─── Capability Check ───────────────────────────────────────
    // Returns what discovery tools are available in this environment.
    // Used by the frontend to show/hide buttons and info messages.
    fastify.get('/capability', async (request, reply) => {
        const capability = await checkDiscoveryCapability();
        return reply.send(capability);
    });

    // ─── Discovered Devices List ────────────────────────────────
    fastify.get('/discovered', async (request, reply) => {
        const { segment_id, is_wired, ai_identified, search, limit = 200, offset = 0 } = request.query;

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
        ON aid.id = (
          SELECT id FROM ai_device_identifications
          WHERE mac_address = dd.mac_address
          ORDER BY id DESC LIMIT 1
        )
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
        // Search filter: match MAC, IP, or hostname
        if (search && search.trim()) {
            query += ` AND (dd.mac_address LIKE ? OR dd.last_ip LIKE ? OR dd.hostname LIKE ?)`;
            const term = `%${search.trim()}%`;
            params.push(term, term, term);
        }

        // First get total count
        let countQuery = query;
        // Strip out the SELECT ... FROM down to SELECT count(*) FROM
        countQuery = countQuery.replace(/SELECT dd\.\*.*?FROM discovered_devices dd/s, 'SELECT count(*) as total FROM discovered_devices dd');
        const totalResult = db.prepare(countQuery).get(...params);
        const total = totalResult ? totalResult.total : 0;

        // Apply pagination
        const pageNum = parseInt(request.query.page || 1, 10);
        const limitNum = parseInt(limit, 10);
        // Use provided offset if there, otherwise calculate from page
        const offsetNum = parseInt(offset, 10) !== 0 ? parseInt(offset, 10) : (pageNum - 1) * limitNum;

        query += ` ORDER BY dd.last_seen DESC LIMIT ? OFFSET ?`;
        params.push(limitNum, offsetNum);

        const devices = db.prepare(query).all(...params).map(d => ({
            ...d,
            is_wired: d.is_wired === 1 ? true : d.is_wired === 0 ? false : null,
            ai_identified: d.ai_identified === 1
        }));
        
        return reply.send({ 
            devices,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                hasMore: offsetNum + limitNum < total
            } 
        });
    });

    // ─── Discovery Stats ────────────────────────────────────────
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

        const by_source = db.prepare(`
      SELECT source, count(*) as count
      FROM discovered_devices
      GROUP BY source
    `).all();

        const last_harvest = db.prepare('SELECT last_seen FROM discovered_devices ORDER BY last_seen DESC LIMIT 1').get()?.last_seen || null;

        return reply.send({
            total,
            identified,
            unidentified: total - identified,
            wired,
            wireless,
            by_segment,
            by_source,
            last_harvest
        });
    });

    // ─── ARP Scan (L2 only, auto-detected) ──────────────────────
    // No segmentId needed — always scans the server's own L2 segment.
    fastify.post('/arp-scan', async (request, reply) => {
        // Pre-check capability
        const capability = await checkDiscoveryCapability();
        if (!capability.can_arp_scan) {
            return reply.code(503).send({
                error: true,
                message: capability.platform_note || 'ARP scan not available in this environment'
            });
        }

        if (isArpScanRunning()) {
            return reply.code(409).send({ error: true, message: 'ARP scan already in progress' });
        }

        // Run async — return 202 immediately
        setImmediate(() => {
            arpScanL2Segment(fastify.io).catch(err => {
                fastify.log.error(`ARP Scan failed: ${err.message}`);
            });
        });

        return reply.code(202).send({
            started: true,
            cidr: capability.l2_segment?.cidr,
            segment: capability.l2_segment?.segment
        });
    });

    // ─── ARP Scan Status ────────────────────────────────────────
    fastify.get('/arp-status', async (request, reply) => {
        return reply.send({ running: isArpScanRunning() });
    });

    // ─── MAC Tracking Stats ─────────────────────────────────────
    fastify.get('/mac-stats', async (request, reply) => {
        return reply.send(getMacTrackingStats());
    });

    fastify.post('/mac-stats/reset', async (request, reply) => {
        resetMacTrackingStats();
        return reply.send({ reset: true });
    });

    // ─── UniFi Harvest (manual trigger) ─────────────────────────
    // Fetches all active WiFi clients + historical users from UniFi API.
    fastify.post('/harvest-unifi', async (request, reply) => {
        try {
            const result = await harvestUnifiClients();
            return reply.send({ success: true, ...result });
        } catch (err) {
            return reply.code(500).send({ error: true, message: safeError(err) });
        }
    });

    // ─── Batch AI Identification ────────────────────────────────
    fastify.post('/identify-all', async (request, reply) => {
        if (identificationRunning) {
            return reply.code(409).send({ error: true, message: 'Identification batch already in progress' });
        }

        const unidentified = db.prepare(
            'SELECT * FROM discovered_devices WHERE ai_identified = 0'
        ).all();

        if (unidentified.length === 0) {
            return reply.send({ started: false, message: 'No unidentified devices found.' });
        }

        identificationRunning = true;

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

                    // Ensure device exists in devices table for AI identification
                    const exists = db.prepare('SELECT id FROM devices WHERE mac_address = ?').get(device.mac_address);
                    if (!exists) {
                        if (device.last_ip) {
                            try {
                                db.prepare(`
                                    INSERT INTO devices (hostname, ip_address, mac_address, device_type, is_critical)
                                    VALUES (?, ?, ?, 'other', 0)
                                `).run(device.hostname || null, device.last_ip, device.mac_address);
                            } catch (e) {
                                if (fastify.io) {
                                    fastify.io.emit('discovery:ip_collision', {
                                        mac: device.mac_address,
                                        ip: device.last_ip,
                                        error: e.message
                                    });
                                }
                                fastify.log.warn(`IP collision for ${device.mac_address}: ${e.message}`);
                            }
                        }
                    }

                    await identifyDiscoveredDevice(device.mac_address);
                    count++;

                    // Wait 3s between calls to not hammer the AI API
                    await new Promise(r => setTimeout(r, 3000));
                } catch (err) {
                    fastify.log.error(`Failed to identify ${device.mac_address}: ${err.message}`);
                }
            }

            identificationRunning = false;

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
