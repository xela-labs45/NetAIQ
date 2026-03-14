const db = require('../db/database');
const { z } = require('zod');
const { scanSegment } = require('../services/scanService');
const mergeService = require('../services/mergeService');
const { Netmask } = require('netmask');

const segmentSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    cidr: z.string().regex(/^([0-9]{1,3}\.){3}[0-9]{1,3}\/([0-9]|[1-2][0-9]|3[0-2])$/, 'Invalid CIDR notation'),
    description: z.string().optional().nullable(),
    color: z.string().optional().nullable()
});

module.exports = async function (fastify, opts) {
    fastify.addHook('preValidation', fastify.authenticate);

    fastify.get('/', async (request, reply) => {
        const segments = db.prepare(`
            SELECT s.*,
                   (SELECT count(*) FROM devices d WHERE d.segment_id = s.id) as registered_count,
                   (SELECT scanned_at FROM scan_results sr WHERE sr.segment_id = s.id ORDER BY scanned_at DESC LIMIT 1) as last_scan_at,
                   (SELECT hosts_found FROM scan_results sr WHERE sr.segment_id = s.id ORDER BY scanned_at DESC LIMIT 1) as scan_total,
                   (SELECT hosts_up FROM scan_results sr WHERE sr.segment_id = s.id ORDER BY scanned_at DESC LIMIT 1) as scan_up
            FROM segments s
        `).all();

        // Add online_count from merged online list
        const onlineDevices = await mergeService.mergeOnlineDevices();

        const enrichedSegments = segments.map(seg => {
            const block = new Netmask(seg.cidr);
            const online_count = onlineDevices.filter(d => d.ip && block.contains(d.ip)).length;

            return {
                ...seg,
                scan_total: seg.scan_total || 0,
                scan_up: seg.scan_up || 0,
                online_count
            };
        });

        reply.send({ segments: enrichedSegments });
    });

    fastify.post('/', async (request, reply) => {
        const validation = segmentSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.code(400).send({
                error: true,
                message: validation.error.errors[0].message
            });
        }

        const { name, cidr, description, color } = validation.data;
        try {
            const stmt = db.prepare('INSERT INTO segments (name, cidr, description, color) VALUES (?, ?, ?, ?)');
            const info = stmt.run(name, cidr, description || null, color || null);
            const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(info.lastInsertRowid);
            reply.send({ segment });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.put('/:id', async (request, reply) => {
        const { id } = request.params;
        const validation = segmentSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.code(400).send({
                error: true,
                message: validation.error.errors[0].message
            });
        }

        const { name, cidr, description, color } = validation.data;
        db.prepare('UPDATE segments SET name = ?, cidr = ?, description = ?, color = ? WHERE id = ?')
            .run(name, cidr, description || null, color || null, id);
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

        const segment = db.prepare('SELECT id FROM segments WHERE id = ?').get(id);
        if (!segment) {
            return reply.code(404).send({ error: true, message: 'Segment not found' });
        }

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
