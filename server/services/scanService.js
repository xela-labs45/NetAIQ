const pLimit = require('p-limit');
const { Netmask } = require('netmask');
const pingService = require('./pingService');
const db = require('../db/database');

let isScanRunning = false;

async function scanSegment(segmentId, fastify) {
    if (isScanRunning) {
        throw new Error('A scan is already in progress.');
    }

    isScanRunning = true;

    try {
        const segment = db.prepare('SELECT id, cidr FROM segments WHERE id = ?').get(segmentId);
        if (!segment) {
            throw new Error('Segment not found.');
        }

        const block = new Netmask(segment.cidr);
        const ips = [];
        block.forEach((ip) => {
            ips.push(ip);
        });

        const limit = pLimit(5);
        let scannedCount = 0;
        const total = ips.length;
        const results = [];

        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        const tasks = ips.map(ip => limit(async () => {
            const res = await pingService.performPing({ ip_address: ip });
            scannedCount++;

            const hostData = {
                ip,
                status: res.status,
                latency_ms: res.latency_ms
            };

            results.push(hostData);

            if (fastify && fastify.io) {
                fastify.io.emit('scan:progress', {
                    segment_id: segmentId,
                    scanned: scannedCount,
                    total,
                    current_ip: ip,
                    status: res.status
                });
            }

            await delay(50); // 50ms delay between batches roughly
        }));

        await Promise.all(tasks);

        // Save results
        const hostsUp = results.filter(r => r.status === 'up').length;
        db.prepare(`
      INSERT INTO scan_results (segment_id, hosts_found, hosts_up, raw_json)
      VALUES (?, ?, ?, ?)
    `).run(segmentId, total, hostsUp, JSON.stringify(results));

        if (fastify && fastify.io) {
            fastify.io.emit('scan:complete', {
                segment_id: segmentId,
                results_summary: {
                    scanned: total,
                    hosts_up: hostsUp
                }
            });
        }

        return results;

    } finally {
        isScanRunning = false;
    }
}

module.exports = {
    scanSegment
};
