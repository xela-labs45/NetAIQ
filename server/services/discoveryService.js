const db = require('../db/database');
const unifiService = require('./unifiService');
const { lookupMac, isRandomisedMac } = require('./macOuiService');
const pLimit = require('p-limit');
const ping = require('ping');
const { Netmask } = require('netmask');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// MAC tracking stats for monitoring
const macTrackingStats = {
    inserted: 0,
    updated: 0,
    ignored: 0,
    ipChanges: 0,
    lastReset: Date.now()
};

let arpScanRunning = false;

function getMacTrackingStats() {
    return { ...macTrackingStats };
}

function resetMacTrackingStats() {
    macTrackingStats.inserted = 0;
    macTrackingStats.updated = 0;
    macTrackingStats.ignored = 0;
    macTrackingStats.ipChanges = 0;
    macTrackingStats.lastReset = Date.now();
}

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
    if (!mac) {
        macTrackingStats.ignored++;
        console.warn(`[Discovery] Skipping device with invalid MAC: ${device.mac} (IP: ${device.ip}, Source: ${device.source})`);
        return null; // skip invalid MACs
    }

    // Skip link-local and broadcast MACs
    if (isIgnoredMac(mac)) {
        macTrackingStats.ignored++;
        console.log(`[Discovery] Ignored MAC (multicast/broadcast): ${mac} (IP: ${device.ip}, Source: ${device.source})`);
        return null;
    }

    // Check for randomized MACs (privacy concern - log for awareness)
    const isRandomized = isRandomisedMac(mac);
    if (isRandomized) {
        console.log(`[Discovery] Detected randomized MAC: ${mac} (IP: ${device.ip}, Source: ${device.source})`);
    }

    const existing = db.prepare(`SELECT id, last_ip, hostname FROM discovered_devices WHERE mac_address = ?`).get(mac);

    if (existing) {
        // Check for IP change (could indicate roaming or IP conflict)
        const oldIp = existing.last_ip;
        const newIp = device.ip || null;
        if (oldIp && newIp && oldIp !== newIp) {
            macTrackingStats.ipChanges++;
            console.log(`[Discovery] MAC ${mac} changed IP: ${oldIp} -> ${newIp} (Source: ${device.source})`);
        }

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
        macTrackingStats.updated++;
        return { action: 'updated', mac, id: existing.id };
    } else {
        // New device — insert and do OUI lookup for vendor
        const oui = lookupMac(mac);

        try {
            const result = db.prepare(`
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
            macTrackingStats.inserted++;
            console.log(`[Discovery] New device discovered: ${mac} (IP: ${device.ip}, Vendor: ${oui?.manufacturer || 'Unknown'}, Source: ${device.source})`);
            return { action: 'inserted', mac, id: result.lastInsertRowid };
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                console.warn(`[Discovery] MAC collision detected: ${mac} - Race condition or normalization issue`);
                return null;
            }
            throw err;
        }
    }
}

async function harvestUnifiWifi() {
    const clients = await unifiService.getClients();
    if (!clients) return { harvested: 0, inserted: 0, updated: 0 };

    let inserted = 0;
    let updated = 0;
    let ignored = 0;

    for (const client of clients) {
        if (!client.mac) {
            ignored++;
            continue;
        }

        // Find segment_id by matching client IP to segment CIDR
        const segment = findSegmentForIp(client.ip);

        const result = upsertDevice({
            mac: client.mac,
            ip: client.ip,
            hostname: client.hostname || client.name || null,
            is_wired: client.is_wired ? 1 : 0,
            source: client.is_wired ? 'unifi_wired' : 'unifi_wifi',
            segment_id: segment?.id || null
        });

        if (result?.action === 'inserted') inserted++;
        else if (result?.action === 'updated') updated++;
        else ignored++;
    }

    console.log(`[Discovery] UniFi harvest: ${inserted} new, ${updated} updated, ${ignored} ignored`);
    return { harvested: inserted + updated, inserted, updated, ignored };
}

function parseArpOutput(output) {
    const entries = [];
    const lines = output.split('\n');

    for (const line of lines) {
        // Robust regex to capture IP and MAC from common "arp -a" outputs
        // Matches:
        // - "hostname (1.2.3.4) at 00:11:22:33:44:55 [ether]"
        // - "? (1.2.3.4) at 00:11:22:33:44:55 [ether]"
        // - "1.2.3.4  00-11-22-33-44-55  static"
        // - "1.2.3.4  00:11:22:33:44:55"

        const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        const macMatch = line.match(/([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})/);
        const hostMatch = line.match(/^(\S+)\s+\(/); // Try to get hostname if it exists at start of line

        if (ipMatch && macMatch) {
            entries.push({
                hostname: (hostMatch && hostMatch[1] !== '?') ? hostMatch[1] : null,
                ip: ipMatch[1],
                mac: macMatch[1].replace(/-/g, ':').toLowerCase()
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
    const sId = Number(segmentId);
    const segment = db.prepare('SELECT * FROM segments WHERE id = ?').get(sId);
    if (!segment) throw new Error('Segment not found');

    // Parse IP range from CIDR
    const block = new Netmask(segment.cidr);
    const ips = [];
    block.forEach(ip => ips.push(ip));

    // Emit scan started event
    if (fastify && fastify.io) {
        fastify.io.emit('discovery:arp_started', {
            segment_id: sId,
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
                segment_id: sId,
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
            segment_id: sId
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
        `).run(sId, ips.length, discovered, JSON.stringify(scanResultsForMerge));
    } catch (e) {
        console.error('Failed to save ARP scan to scan_results:', e.message);
    }

    // Emit completion
    if (fastify && fastify.io) {
        fastify.io.emit('discovery:arp_complete', {
            segment_id: sId,
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
    findSegmentForIp,
    getMacTrackingStats,
    resetMacTrackingStats
};
