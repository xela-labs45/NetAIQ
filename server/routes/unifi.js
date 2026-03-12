const unifiService = require('../services/unifiService');

module.exports = async function (fastify, opts) {
    fastify.addHook('preValidation', fastify.authenticate);

    fastify.get('/clients', async (request, reply) => {
        try {
            const data = await unifiService.getClients();
            reply.send(data || { data: [] });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.get('/devices', async (request, reply) => {
        try {
            const data = await unifiService.getDevices();
            reply.send(data || { data: [] });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.get('/health', async (request, reply) => {
        try {
            const data = await unifiService.getSiteHealth();
            reply.send(data || { data: [] });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.get('/wan', async (request, reply) => {
        try {
            const stats = await unifiService.getWanStats();
            reply.send({ stats });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.post('/report/daily-user', async (request, reply) => {
        try {
            const { macs, start, end } = request.body;
            const data = await unifiService.getDailyUserReport(macs ? macs[0] : null, start, end);
            reply.send(data || { data: [] });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    fastify.post('/report/hourly-site', async (request, reply) => {
        try {
            const { start, end } = request.body;
            const data = await unifiService.getHourlySiteReport(start, end);
            reply.send(data || { data: [] });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });
};
