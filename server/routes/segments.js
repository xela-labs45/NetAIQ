const db = require('../db/database');
const { scanSegment } = require('../services/scanService');

module.exports = async function (fastify, opts) {
    fastify.addHook('preValidation', fastify.authenticate);

    fastify.get('/', async (request, reply) => {
        const segments = db.prepare(`
      SELECT s.*,
             (SELECT count(*) FROM devices d WHERE d.segment_id = s.id) as device_count,
             (SELECT count(*) FROM devices d 
              WHERE d.segment_id = s.id 
              AND (SELECT status FROM ping_history ph WHERE ph.device_id = d.id ORDER BY timestamp DESC LIMIT 1) = 'up'
             ) as devices_up,
             (SELECT scanned_at FROM scan_results sr WHERE sr.segment_id = s.id ORDER BY scanned_at DESC LIMIT 1) as last_scan
      FROM segments s
    `).all();

        reply.send({ segments });
    });

    fastify.post('/', async (request, reply) => {
        const { name, cidr, description, color } = request.body;
        try {
            const stmt = db.prepare('INSERT INTO segments (name, cidr, description, color) VALUES (?, ?, ?, ?)');
            const info = stmt.run(name, cidr, description, color);
            const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(info.lastInsertRowid);
            reply.send({ segment });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const { name, cidr, description, color } = request.body;
        db.prepare('UPDATE segments SET name = ?, cidr = ?, description = ?, color = ? WHERE id = ?')
            .run(name, cidr, description, color, id);
        const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(id);
        reply.send({ segment });
    });

    fastify.delete('/:id', async (request, reply) => {
        const { id } = request.params;
        db.prepare('DELETE FROM segments WHERE id = ?').run(id);
        reply.send({ success: true });
    });

    fastify.post('/:id/scan', async (request, reply) => {
        const { id } = request.params;

        // Run async, background task
        scanSegment(id, fastify).catch(err => fastify.log.error(err));

        reply.code(202).send({ message: 'Scan started' });
    });

    fastify.get('/:id/scans', async (request, reply) => {
        const { id } = request.params;
        const scans = db.prepare('SELECT * FROM scan_results WHERE segment_id = ? ORDER BY scanned_at DESC LIMIT 5').all(id);
        // Parse json
        const results = scans.map(s => {
            let parsed = [];
            try { parsed = JSON.parse(s.raw_json); } catch (e) { }
            return { ...s, results: parsed };
        });
        reply.send({ scans: results });
    });
};
