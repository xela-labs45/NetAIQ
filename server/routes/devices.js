const db = require('../db/database');
const { pingDevice } = require('../services/pingService');

module.exports = async function (fastify, opts) {

    // Protect all device routes
    fastify.addHook('preValidation', fastify.authenticate);

    fastify.get('/', async (request, reply) => {
        // Get all devices with their latest status and segment details
        const devices = db.prepare(`
      SELECT d.*, 
             s.name as segment_name, s.color as segment_color,
             (SELECT status FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) as status,
             (SELECT latency_ms FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) as latency_ms,
             (SELECT timestamp FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) as last_seen
      FROM devices d
      LEFT JOIN segments s ON d.segment_id = s.id
    `).all();

        reply.send({ devices });
    });

    fastify.post('/', async (request, reply) => {
        const { hostname, ip_address, mac_address, device_type, segment_id, is_critical, notes } = request.body;

        try {
            const stmt = db.prepare(`
        INSERT INTO devices (hostname, ip_address, mac_address, device_type, segment_id, is_critical, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

            const info = stmt.run(hostname, ip_address, mac_address, device_type, segment_id || null, is_critical ? 1 : 0, notes);

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
        const { hostname, ip_address, mac_address, device_type, segment_id, is_critical, notes } = request.body;

        try {
            db.prepare(`
        UPDATE devices 
        SET hostname = ?, ip_address = ?, mac_address = ?, device_type = ?, segment_id = ?, is_critical = ?, notes = ?
        WHERE id = ?
      `).run(hostname, ip_address, mac_address, device_type, segment_id || null, is_critical ? 1 : 0, notes, id);

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
