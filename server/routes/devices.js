const db = require('../db/database');
const { z } = require('zod');
const { pingDevice } = require('../services/pingService');
const { mergeOnlineDevices, getOnlineCount } = require('../services/mergeService');
const { lookupMac } = require('../services/macOuiService');

function normaliseMac(mac) {
    if (!mac) return null;
    const clean = String(mac).replace(/[^a-fA-F0-9]/g, '');
    if (clean.length !== 12) return mac; // fallback to original if parsing fails
    return clean.toLowerCase().match(/.{2}/g).join(':');
}

const deviceSchema = z.object({
    hostname: z.string().optional().nullable(),
    ip_address: z.string().ip({ version: 'v4', message: 'Invalid IPv4 address' }),
    mac_address: z.string().regex(/^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/, 'Invalid MAC address format').optional().nullable().or(z.literal('')),
    device_type: z.string().optional().default('workstation'),
    segment_id: z.number().optional().nullable(),
    is_critical: z.union([z.boolean(), z.number()]).optional().default(0),
    notes: z.string().optional().nullable()
});

module.exports = async function (fastify, opts) {

    // Protect all device routes
    fastify.addHook('preValidation', fastify.authenticate);

    // ── Merged online devices (must be before /:id routes) ──
    fastify.get('/online', async (request, reply) => {
        const { connection } = request.query || {};
        let devices = await mergeOnlineDevices();

        if (connection === 'wired') {
            devices = devices.filter(d => d.is_wired === true);
        } else if (connection === 'wireless') {
            devices = devices.filter(d => d.is_wired === false);
        }

        reply.send({ devices });
    });

    fastify.get('/online/count', async (request, reply) => {
        const counts = await getOnlineCount();
        reply.send(counts);
    });

    fastify.get('/', async (request, reply) => {
        // Get all devices with their latest status and segment details
        const devices = db.prepare(`
      SELECT d.*, 
             s.name as segment_name, s.color as segment_color,
             ai.manufacturer as ai_manufacturer,
             ai.device_type_suggestion as ai_device_type,
             ai.os_guess as ai_os,
             ai.confidence as ai_confidence,
             ai.reasoning as ai_reasoning,
             ai.suggested_name as ai_suggested_name,
             (SELECT status FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) as status,
             (SELECT latency_ms FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) as latency_ms,
             (SELECT timestamp FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) as last_seen
      FROM devices d

      LEFT JOIN segments s ON d.segment_id = s.id
      LEFT JOIN ai_device_identifications ai ON d.id = ai.device_id
    `).all();


        reply.send({ devices });
    });

    fastify.post('/bulk', async (request, reply) => {
        const { devices } = request.body;
        if (!Array.isArray(devices)) {
            return reply.code(400).send({ error: true, message: 'Expected an array of devices' });
        }

        let registered = 0;
        let skipped = 0;
        const errors = [];

        // Check for existing segments if you want, or just leave segment_id null
        // Doing simple approach as requested.
        const insertStmt = db.prepare(`
            INSERT INTO devices (hostname, ip_address, mac_address, vendor, device_type, is_critical, notes)
            VALUES (?, ?, ?, ?, 'workstation', 0, 'Auto-registered from live scan')
        `);

        // Check existing ones
        const checkIpStmt = db.prepare('SELECT id FROM devices WHERE ip_address = ?');
        const checkMacStmt = db.prepare('SELECT id FROM devices WHERE lower(mac_address) = lower(?)');

        const tx = db.transaction((devicesList) => {
            for (const d of devicesList) {
                if (!d.ip) {
                    skipped++;
                    continue;
                }

                // Skip if IP exists
                if (checkIpStmt.get(d.ip)) {
                    skipped++;
                    continue;
                }

                const normalizedMac = normaliseMac(d.mac);

                // Skip if MAC exists
                if (normalizedMac && checkMacStmt.get(normalizedMac)) {
                    skipped++;
                    continue;
                }

                try {
                    // Look up vendor if not in request
                    const vendor = d.vendor || (normalizedMac ? lookupMac(normalizedMac)?.manufacturer : null);
                    const info = insertStmt.run(d.hostname || null, d.ip, normalizedMac, vendor);

                    const newDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid);
                    // Initial ping asynchronously
                    setImmediate(() => {
                        pingDevice(newDevice, fastify).catch(e => fastify.log.error(e));
                    });

                    registered++;
                } catch (err) {
                    errors.push({ ip: d.ip, error: err.message });
                }
            }
        });

        tx(devices);

        reply.send({ registered, skipped, errors });
    });

    fastify.post('/', async (request, reply) => {
        const validation = deviceSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.code(400).send({
                error: true,
                message: validation.error.errors[0].message
            });
        }

        const { hostname, ip_address, mac_address, device_type, segment_id, is_critical, notes } = validation.data;

        try {
            const normalizedMac = normaliseMac(mac_address);
            const vendor = request.body.vendor || (normalizedMac ? lookupMac(normalizedMac)?.manufacturer : null);
            const stmt = db.prepare(`
        INSERT INTO devices (hostname, ip_address, mac_address, vendor, device_type, segment_id, is_critical, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

            const info = stmt.run(hostname || null, ip_address, normalizedMac || null, vendor, device_type, segment_id || null, is_critical ? 1 : 0, notes || null);

            const newDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get(info.lastInsertRowid);

            // Initial ping asynchronously
            pingDevice(newDevice, fastify).catch(e => fastify.log.error(e));

            reply.send({ device: newDevice });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                reply.code(400).send({ error: true, message: 'IP address already exists.' });
            } else {
                reply.code(500).send({ error: true, message: err.message });
            }
        }
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const validation = deviceSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.code(400).send({
                error: true,
                message: validation.error.errors[0].message
            });
        }

        const { hostname, ip_address, mac_address, device_type, segment_id, is_critical, notes } = validation.data;

        try {
            const normalizedMac = normaliseMac(mac_address);
            const vendor = request.body.vendor || (normalizedMac ? lookupMac(normalizedMac)?.manufacturer : null);
            db.prepare(`
        UPDATE devices 
        SET hostname = ?, ip_address = ?, mac_address = ?, vendor = ?, device_type = ?, segment_id = ?, is_critical = ?, notes = ?
        WHERE id = ?
      `).run(hostname || null, ip_address, normalizedMac || null, vendor, device_type, segment_id || null, is_critical ? 1 : 0, notes || null, id);

            const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
            reply.send({ device });
        } catch (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                reply.code(400).send({ error: true, message: 'IP address already exists.' });
            } else {
                reply.code(500).send({ error: true, message: err.message });
            }
        }
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;
        db.prepare('DELETE FROM devices WHERE id = ?').run(id);
        reply.send({ success: true });
    });

    fastify.post('/:id/ping', async (request, reply) => {
        const { id } = request.params;
        const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);

        if (!device) {
            return reply.code(404).send({ error: true, message: 'Device not found' });
        }

        const result = await pingDevice(device, fastify);
        reply.send({ result });
    });

    fastify.get('/:id/history', async (request, reply) => {
        const { id } = request.params;
        const { hours = 24 } = request.query;

        const timeLimit = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();

        // Grab every Nth result to avoid sending too much data if doing 24h
        // Simple approach: grab up to latest 500 records
        const history = db.prepare(`
      SELECT timestamp, status, latency_ms
      FROM ping_history 
      WHERE device_id = ? AND timestamp >= ?
      ORDER BY timestamp ASC
    `).all(id, timeLimit);

        reply.send({ history });
    });

    fastify.get('/:id/uptime', async (request, reply) => {
        const { id } = request.params;

        const getUptime = (hours) => {
            const timeLimit = new Date(Date.now() - (hours * 60 * 60 * 1000)).toISOString();
            const stats = db.prepare(`
        SELECT count(*) as total, 
               SUM(CASE WHEN status = 'up' THEN 1 ELSE 0 END) as up_count
        FROM ping_history 
        WHERE device_id = ? AND timestamp >= ?
      `).get(id, timeLimit);

            if (stats.total === 0) return 0;
            return (stats.up_count / stats.total) * 100;
        };

        reply.send({
            uptime_24h: getUptime(24),
            uptime_7d: getUptime(24 * 7)
        });
    });

};
