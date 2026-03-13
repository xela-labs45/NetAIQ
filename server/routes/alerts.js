const db = require('../db/database');
const alertService = require('../services/alertService');

module.exports = async function (fastify, opts) {
    fastify.addHook('preValidation', fastify.authenticate);

    fastify.get('/', async (request, reply) => {
        const { unread } = request.query;

        let query = `
      SELECT a.*, d.hostname, d.ip_address 
      FROM alerts a
      LEFT JOIN devices d ON a.device_id = d.id
    `;

        if (unread === 'true') {
            query += ' WHERE a.is_read = 0';
        }

        query += ' ORDER BY a.created_at DESC LIMIT 100';

        const alerts = db.prepare(query).all();
        reply.send({ alerts });
    });

    fastify.put('/:id/read', async (request, reply) => {
        const { id } = request.params;
        alertService.markAsRead(id);

        // emit updated count
        if (fastify.io) {
            fastify.io.emit('alert:count', alertService.getUnreadCount());
        }

        reply.send({ success: true });
    });

    fastify.put('/read-all', async (request, reply) => {
        db.prepare('UPDATE alerts SET is_read = 1 WHERE is_read = 0').run();

        if (fastify.io) {
            fastify.io.emit('alert:count', { unread_count: 0, critical_count: 0, warning_count: 0 });
        }

        reply.send({ success: true });
    });

    fastify.get('/count', async (request, reply) => {
        reply.send(alertService.getUnreadCount());
    });
};
