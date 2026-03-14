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

    fastify.get('/clients-usage', async (request, reply) => {
        try {
            const { start, end } = request.query;
            const startTime = parseInt(start, 10) || new Date().setHours(0, 0, 0, 0);
            const endTime = parseInt(end, 10) || Date.now();

            // if range > 3 days, use weekly
            const type = (endTime - startTime) > (3 * 86400000) ? 'weekly' : 'daily';

            const response = await unifiService.getClientsUsage(startTime, endTime, type);

            let reportArray = null;
            if (Array.isArray(response)) reportArray = response;
            else if (Array.isArray(response?.data)) reportArray = response.data;

            console.log('=== daily.user total entries:', reportArray?.length || 0);
            if (reportArray && reportArray.length > 0) {
                console.log('=== daily.user first entry:', JSON.stringify(reportArray[0]));
            }

            const macNameMap = await unifiService.buildMacNameMap();

            let finalData = [];
            let source = 'report';

            if (reportArray && reportArray.length > 0) {
                finalData = reportArray.map(entry => {
                    const mac = (entry.mac || entry.user || '').toLowerCase();
                    const tx = entry.tx_bytes || entry['tx-bytes'] || 0;
                    const rx = entry.rx_bytes || entry['rx-bytes'] || 0;
                    return {
                        mac,
                        name: macNameMap[mac] || mac || 'Unknown',
                        tx_bytes: tx,
                        rx_bytes: rx,
                        total: tx + rx
                    };
                });
            } else {
                // Fallback to real-time
                console.warn('daily.user report empty, falling back to real-time data');
                const clientsResponse = await unifiService.getClients();
                const clients = clientsResponse?.data || clientsResponse || [];
                if (Array.isArray(clients)) {
                    finalData = clients.map(c => {
                        const tx = c.tx_bytes || 0;
                        const rx = c.rx_bytes || 0;
                        return {
                            mac: (c.mac || '').toLowerCase(),
                            name: c.hostname || c.name || c.ip || c.mac || 'Unknown',
                            tx_bytes: tx,
                            rx_bytes: rx,
                            total: tx + rx
                        };
                    });
                    source = 'realtime';
                }
            }

            // Sort and limit
            finalData = finalData
                .filter(d => d.total > 0)
                .sort((a, b) => b.total - a.total)
                .slice(0, 15);

            reply.send({ data: finalData, source });
        } catch (err) {
            console.error('clients-usage error', err);
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

    fastify.get('/wlan', async (request, reply) => {
        try {
            const data = await unifiService.getWlanHealth();
            if (!data) {
                return reply.send({
                    status: 'unavailable',
                    num_user: 0,
                    num_ap: 0,
                    num_adopted: 0,
                    num_disconnected: 0,
                    num_pending: 0,
                    tx_mbps: '0.00',
                    rx_mbps: '0.00'
                });
            }
            reply.send(data);
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
            const { start, end, attrs } = request.body;
            const data = await unifiService.getHourlySiteReport(start, end, attrs);
            reply.send({ data });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });

    // Temporary Debug Endpoint
    fastify.get('/debug', async (request, reply) => {
        try {
            const now = Date.now();
            const todayStart = new Date().setHours(0, 0, 0, 0);

            const [health, clients, users, daily_user] = await Promise.all([
                unifiService.getSiteHealth(),
                unifiService.getClients(),
                unifiService.getAllUsers(),
                unifiService.getDailyUserReport(null, todayStart, now)
            ]);

            reply.send({
                health: health,
                wlan_health: await unifiService.getWlanHealth(),
                clients: (clients?.data || clients || []).slice(0, 2),
                users: (users?.data || users || []).slice(0, 2),
                daily_user: (daily_user?.data || daily_user || []).slice(0, 2)
            });
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message });
        }
    });
};
