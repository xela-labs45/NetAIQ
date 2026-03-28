const db = require('../db/database');
const unifiService = require('./unifiService');
const { lookupMac } = require('./macOuiService');
const pLimit = require('p-limit');
const ping = require('ping');
const { Netmask } = require('netmask');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Concurrency lock for ARP scans
let arpScanRunning = false;

function isArpScanRunning() {
    return arpScanRunning;
}

function normaliseMac(mac) {
    if (!mac) return null;
    const clean = mac.replace(/[^a-fA-F0-9]/g, '');
    if (clean.length !== 12) return null;
    return clean.toLowerCase().match(/.{2}/g).join(':');
}

function isIgnoredMac(mac) {
    if (!mac) return true;
    const ignored = [
        'ff:ff:ff:ff:ff:ff',  // broadcast
        '00:00:00:00:00:00',  // null
    ];
    // Also skip multicast (first byte odd)
    const firstByte = parseInt(mac.split(':')[0], 16);
    return ignored.includes(mac) || (firstByte & 0x01) !== 0;
}

// Match an IP to a configured segment by CIDR
function findSegmentForIp(ip) {
    const segments = db.prepare('SELECT * FROM segments').all();
    for (const seg of segments) {
        try {
            const block = new Netmask(seg.cidr);
            if (block.contains(ip)) return seg;
        } catch { }
    }
    return null;
}

function upsertDevice(device) {
    // Normalise MAC to lowercase with colons
    const mac = normaliseMac(device.mac);
    if (!mac) return; // skip invalid MACs

    // Skip link-local and broadcast MACs
    if (isIgnoredMac(mac)) return;

    const existing = db.prepare(`SELECT id FROM discovered_devices WHERE mac_address = ?`).get(mac);

    if (existing) {
        // Update last known info but keep first_seen
        db.prepare(`
            UPDATE discovered_devices SET
                last_ip   = COALESCE(?, last_ip),
                hostname  = COALESCE(?, hostname),
                is_wired  = COALESCE(?, is_wired),
                source    = ?,
                last_seen = CURRENT_TIMESTAMP
            WHERE mac_address = ?
        `).run(
            device.ip || null,
            device.hostname || null,
            device.is_wired ?? null,
            device.source,
            mac
        );
    } else {
        // New device — insert and do OUI lookup for vendor
        const oui = lookupMac(mac);

        db.prepare(`
            INSERT INTO discovered_devices
                (mac_address, last_ip, hostname, is_wired, source, segment_id, vendor)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            mac,
            device.ip || null,
            device.hostname || null,
            device.is_wired ?? null,
            device.source,
            device.segment_id || null,
            oui?.manufacturer || null
        );
    }
}

async function harvestUnifiWifi() {
    const clients = await unifiService.getClients();
    if (!clients) return { harvested: 0 };

    let count = 0;
    for (const client of clients) {
        if (!client.mac) continue;

        // Find segment_id by matching client IP to segment CIDR
        const segment = findSegmentForIp(client.ip);

        upsertDevice({
            mac: client.mac,
            ip: client.ip,
            hostname: client.hostname || client.name || null,
            is_wired: client.is_wired ? 1 : 0,
            source: client.is_wired ? 'unifi_wired' : 'unifi_wifi',
            segment_id: segment?.id || null
        });
        count++;
    }

    return { harvested: count };
}

function parseArpOutput(output) {
    const entries = [];
    const lines = output.split('\n');

    for (const line of lines) {
        // Linux format: hostname (ip) at mac [ether] on iface
        const linuxMatch = line.match(/(\S+)\s+\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([0-9a-fA-F:]{17})/);
        if (linuxMatch) {
            entries.push({
                hostname: linuxMatch[1] !== '?' ? linuxMatch[1] : null,
                ip: linuxMatch[2],
                mac: linuxMatch[3]
            });
            continue;
        }

        // Windows format: ip  mac  type
        const winMatch = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F\-]{17})\s+\w+/);
        if (winMatch) {
            entries.push({
                hostname: null,
                ip: winMatch[1],
                mac: winMatch[2].replace(/-/g, ':')
            });
        }
    }

    // Filter out incomplete or ignored entries
    return entries.filter(e =>
        e.mac &&
        e.ip &&
        !isIgnoredMac(normaliseMac(e.mac))
    );
}

async function readArpCache() {
    try {
        const { stdout } = await execAsync('arp -a');
        return parseArpOutput(stdout);
    } catch (err) {
        console.error('ARP cache read failed:', err.message);
        return [];
    }
}

async function arpScanSegment(segmentId, fastify) {
    const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(segmentId);
    if (!segment) throw new Error('Segment not found');

    // Parse IP range from CIDR
    const block = new Netmask(segment.cidr);
    const ips = [];
    block.forEach(ip => ips.push(ip));

    // Emit scan started event
    if (fastify && fastify.io) {
        fastify.io.emit('discovery:arp_started', {
            segment_id: segmentId,
            total_ips: ips.length
        });
    }

    // Step 1 — ping all IPs to populate ARP cache
    // Use p-limit concurrency of 5 (non-aggressive)
    const limit = pLimit(5);
    let pinged = 0;

    await Promise.all(ips.map(ip => limit(async () => {
        try {
            await ping.promise.probe(ip, { timeout: 1 });
        } catch { /* ignore — just populating ARP cache */ }
        pinged++;
        // Emit progress every 10 IPs
        if (fastify && fastify.io && pinged % 10 === 0) {
            fastify.io.emit('discovery:arp_progress', {
                segment_id: segmentId,
                pinged,
                total: ips.length
            });
        }
    })));

    // Small delay to let ARP cache settle
    await new Promise(r => setTimeout(r, 500));

    // Step 2 — read OS ARP cache
    const arpEntries = await readArpCache();

    // Step 3 — filter to IPs within this segment only
    const segmentEntries = arpEntries.filter(e => block.contains(e.ip));

    // Step 4 — upsert each discovered device
    let discovered = 0;
    const scanResultsForMerge = [];

    for (const entry of segmentEntries) {
        upsertDevice({
            mac: entry.mac,
            ip: entry.ip,
            hostname: entry.hostname || null,
            is_wired: 1,    // ARP scan = wired assumption
            source: 'arp_scan',
            segment_id: segmentId
        });

        scanResultsForMerge.push({
            ip: entry.ip,
            status: 'up',
            latency_ms: 1, // dummy for ARP
            hostname: entry.hostname || null
        });

        discovered++;
    }

    // NEW: Also save to scan_results so mergeService picks it up for "Online Now"
    // This makes ARP scans contribute to the active devices list immediately.
    try {
        db.prepare(`
            INSERT INTO scan_results (segment_id, total_ips, online_count, raw_json)
            VALUES (?, ?, ?, ?)
        `).run(segmentId, ips.length, discovered, JSON.stringify(scanResultsForMerge));
    } catch (e) {
        console.error('Failed to save ARP scan to scan_results:', e.message);
    }

    // Emit completion
    if (fastify && fastify.io) {
        fastify.io.emit('discovery:arp_complete', {
            segment_id: segmentId,
            ips_pinged: ips.length,
            macs_found: discovered
        });
    }

    return {
        ips_pinged: ips.length,
        macs_found: discovered,
        entries: segmentEntries
    };
}

async function arpScanAllSegments(fastify) {
    const segments = db.prepare('SELECT * FROM segments').all();
    const results = [];
    for (const seg of segments) {
        const result = await arpScanSegment(seg.id, fastify);
        results.push({ segment: seg.name, ...result });
    }
    return results;
}

async function safeArpScan(segmentId, fastify) {
    if (arpScanRunning) {
        throw new Error('An ARP scan is already in progress');
    }
    arpScanRunning = true;
    try {
        return await arpScanSegment(segmentId, fastify);
    } finally {
        arpScanRunning = false;
    }
}

async function safeArpScanAll(fastify) {
    if (arpScanRunning) {
        throw new Error('An ARP scan is already in progress');
    }
    arpScanRunning = true;
    try {
        return await arpScanAllSegments(fastify);
    } finally {
        arpScanRunning = false;
    }
}

module.exports = {
    harvestUnifiWifi,
    safeArpScan,
    safeArpScanAll,
    isArpScanRunning,
    upsertDevice,
    findSegmentForIp
};
