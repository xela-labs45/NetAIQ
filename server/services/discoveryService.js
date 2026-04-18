/**
 * discoveryService.js
 * 
 * MAC address discovery via two sources:
 *   1) UniFi API — all WiFi + UniFi-seen wired clients (+ historical)
 *   2) nmap ARP scan — L2 segment only, auto-detected from server IP
 * 
 * ARP scanning only works on the server's own L2 segment because ARP
 * is a Layer 2 protocol and cannot cross router/L3 boundaries.
 * The L2 segment is auto-detected at runtime from OS network interfaces
 * matched against configured segments in the database.
 * 
 * Tool priority for ARP: nmap (primary) → ip neigh (supplement) → arp -a (fallback)
 */

const db = require('../db/database');
const unifiService = require('./unifiService');
const settingsService = require('./settingsService');
const { lookupMac, isRandomisedMac } = require('./macOuiService');
const { Netmask } = require('netmask');
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ─── State ──────────────────────────────────────────────────────────
let arpScanRunning = false;

// MAC tracking stats for monitoring
const macTrackingStats = {
    inserted: 0,
    updated: 0,
    ignored: 0,
    ipChanges: 0,
    lastReset: Date.now()
};

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

// ─── MAC Helpers ────────────────────────────────────────────────────

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

// ─── Segment Helpers ────────────────────────────────────────────────

/**
 * Match an IP to a configured segment by CIDR.
 */
function findSegmentForIp(ip) {
    if (!ip) return null;
    const segments = db.prepare('SELECT * FROM segments').all();
    for (const seg of segments) {
        try {
            const block = new Netmask(seg.cidr);
            if (block.contains(ip)) return seg;
        } catch { /* invalid CIDR, skip */ }
    }
    return null;
}

/**
 * Convert IP + netmask to CIDR notation.
 * e.g. (192.168.1.5, 255.255.255.0) → "192.168.1.0/24"
 */
function ipToCidr(ip, netmask) {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);
    // Count bits in netmask
    const bits = maskParts.reduce((acc, part) => {
        return acc + part.toString(2).split('').filter(b => b === '1').length;
    }, 0);
    // Compute network address
    const network = ipParts.map((p, i) => p & maskParts[i]);
    return `${network.join('.')}/${bits}`;
}

/**
 * Auto-detect the server's L2 segment by reading OS network interfaces
 * and matching against configured segments in the database.
 * 
 * Priority: skip loopback and virtual/container interfaces by name.
 * Prefer interfaces whose IP falls within a configured segment.
 */
function getServerL2Segment() {
    const interfaces = os.networkInterfaces();
    const segments = db.prepare('SELECT * FROM segments').all();
    const isDev = process.env.NODE_ENV !== 'production';

    const candidates = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
        // Skip loopback early
        if (name === 'lo') {
            if (isDev) console.log(`[Discovery] Interface ${name}: skipped (loopback)`);
            continue;
        }

        // Skip virtual/container interfaces by name
        if (/^(docker|br-|veth|virbr|lxc|lxd|cni|flannel|calico)/.test(name)) {
            if (isDev) console.log(`[Discovery] Interface ${name}: skipped (virtual/container)`);
            continue;
        }

        for (const addr of (addrs || [])) {
            // IPv4 only
            if (addr.family !== 'IPv4') continue;

            if (addr.internal) {
                if (isDev) console.log(`[Discovery] Interface ${name} IP ${addr.address}: skipped (internal)`);
                continue;
            }

            // Save candidate for fallback pass
            candidates.push({ name, addr });

            // Check if this IP falls within a configured segment
            let matchedSegment = null;
            for (const segment of segments) {
                try {
                    const block = new Netmask(segment.cidr);
                    if (block.contains(addr.address)) {
                        matchedSegment = segment;
                        break;
                    }
                } catch { continue; }
            }

            if (matchedSegment) {
                if (isDev) console.log(`[Discovery] Interface ${name} IP ${addr.address}: matched segment ${matchedSegment.name} (${matchedSegment.cidr})`);
                return {
                    ip: addr.address,
                    cidr: matchedSegment.cidr,
                    segment_id: matchedSegment.id,
                    segment: matchedSegment.name,
                    interface: name,
                    netmask: addr.netmask
                };
            } else {
                if (isDev) console.log(`[Discovery] Interface ${name} IP ${addr.address}: not in any configured segment`);
            }
        }
    }

    // Fallback: second pass to use the first valid candidate
    if (candidates.length > 0) {
        const { name, addr } = candidates[0];
        const cidr = ipToCidr(addr.address, addr.netmask);
        if (isDev) console.log(`[Discovery] Interface ${name} IP ${addr.address}: fallback to computed CIDR ${cidr}`);
        return {
            ip: addr.address,
            cidr,
            segment_id: null,
            segment: 'Auto-detected',
            interface: name,
            netmask: addr.netmask
        };
    }

    if (isDev) console.log(`[Discovery] No valid interface found for L2 segment detection.`);
    return null;
}

// ─── Capability Detection ───────────────────────────────────────────

let capabilityCache = null;

/**
 * Runtime check of what discovery tools are available in this environment.
 * Results are cached for 5 minutes.
 */
async function checkDiscoveryCapability() {
    if (capabilityCache) return capabilityCache;

    const capability = {
        nmap_available: false,
        ip_neigh_available: false,
        arp_available: false,
        l2_segment_detected: false,
        l2_segment: null,
        unifi_available: false,
        // Overall capability summary
        can_arp_scan: false,
        can_unifi_harvest: false,
        platform_note: null
    };

    // Check nmap
    try {
        await execAsync('nmap --version');
        capability.nmap_available = true;
    } catch {
        capability.nmap_available = false;
    }

    // Check ip neigh
    try {
        await execAsync('ip neigh show');
        capability.ip_neigh_available = true;
    } catch {
        capability.ip_neigh_available = false;
    }

    // Check arp
    try {
        await execAsync('arp -a');
        capability.arp_available = true;
    } catch {
        capability.arp_available = false;
    }

    // Detect L2 segment
    const l2 = getServerL2Segment();
    if (l2) {
        capability.l2_segment_detected = true;
        capability.l2_segment = l2;
    }

    // Check UniFi
    const unifiUrl = settingsService.get('unifi_url');
    const unifiUser = settingsService.get('unifi_username');
    const unifiPass = settingsService.get('unifi_password');
    capability.unifi_available = !!(unifiUrl && unifiUser && unifiPass);

    // Derive overall capability
    capability.can_arp_scan = (
        capability.nmap_available ||
        capability.ip_neigh_available ||
        capability.arp_available
    ) && capability.l2_segment_detected;

    capability.can_unifi_harvest = capability.unifi_available;

    // Platform note for UI
    if (!capability.nmap_available && !capability.ip_neigh_available) {
        capability.platform_note =
            'ARP tools not available in this environment. ' +
            'MAC discovery limited to UniFi API data. ' +
            'On Linux: ensure NET_RAW capability is set in docker-compose.yml.';
    } else if (!capability.l2_segment_detected) {
        capability.platform_note =
            'Server L2 segment could not be detected. ' +
            'Ensure at least one network segment is configured in the Segments page.';
    }

    // Cache for 5 minutes
    capabilityCache = capability;
    setTimeout(() => { capabilityCache = null; }, 5 * 60 * 1000);

    return capability;
}

// ─── Device Upsert ──────────────────────────────────────────────────

function upsertDevice(device) {
    const mac = normaliseMac(device.mac);
    if (!mac) {
        macTrackingStats.ignored++;
        return null;
    }

    if (isIgnoredMac(mac)) {
        macTrackingStats.ignored++;
        return null;
    }

    // Log randomized MACs for awareness
    if (isRandomisedMac(mac)) {
        console.log(`[Discovery] Detected randomized MAC: ${mac} (IP: ${device.ip}, Source: ${device.source})`);
    }

    const existing = db.prepare(
        'SELECT id, last_ip, hostname FROM discovered_devices WHERE mac_address = ?'
    ).get(mac);

    if (existing) {
        // Track IP changes
        const oldIp = existing.last_ip;
        const newIp = device.ip || null;
        if (oldIp && newIp && oldIp !== newIp) {
            macTrackingStats.ipChanges++;
            console.log(`[Discovery] MAC ${mac} changed IP: ${oldIp} -> ${newIp} (Source: ${device.source})`);
        }

        db.prepare(`
            UPDATE discovered_devices SET
                last_ip    = COALESCE(?, last_ip),
                hostname   = COALESCE(?, hostname),
                is_wired   = COALESCE(?, is_wired),
                source     = ?,
                segment_id = COALESCE(?, segment_id),
                vendor     = COALESCE(?, vendor),
                last_seen  = CURRENT_TIMESTAMP
            WHERE mac_address = ?
        `).run(
            device.ip || null,
            device.hostname || null,
            device.is_wired ?? null,
            device.source,
            device.segment_id || null,
            lookupMac(mac)?.manufacturer || null,
            mac
        );
        macTrackingStats.updated++;
        return { action: 'updated', mac, id: existing.id };
    } else {
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
            console.log(`[Discovery] New device: ${mac} (IP: ${device.ip}, Vendor: ${oui?.manufacturer || 'Unknown'}, Source: ${device.source})`);
            return { action: 'inserted', mac, id: result.lastInsertRowid };
        } catch (err) {
            if (err.message && err.message.includes('UNIQUE constraint failed')) {
                // Race condition — another insert happened between SELECT and INSERT
                return null;
            }
            throw err;
        }
    }
}

// ─── Source 1: UniFi Harvest ────────────────────────────────────────

/**
 * Harvest devices from UniFi API.
 * A) Active clients (stat/sta) — WiFi + wired currently connected
 * B) Historical users (list/user) — devices seen within the last 4 weeks
 */
async function harvestUnifiClients() {
    const results = { wifi: 0, wired: 0, historical: 0, errors: [] };

    // A — Current active clients (stat/sta)
    try {
        const clientsResponse = await unifiService.getClients();
        const clients = clientsResponse?.data || clientsResponse || [];
        if (Array.isArray(clients)) {
            for (const client of clients) {
                if (!client.mac) continue;
                const segment = findSegmentForIp(client.ip);
                upsertDevice({
                    mac: client.mac,
                    ip: client.ip,
                    hostname: client.hostname || client.name || null,
                    is_wired: client.is_wired ? 1 : 0,
                    source: client.is_wired ? 'unifi_wired' : 'unifi_wifi',
                    segment_id: segment?.id || null
                });
                client.is_wired ? results.wired++ : results.wifi++;
            }
        }
    } catch (err) {
        results.errors.push('stat/sta: ' + err.message);
    }

    // B — Historical users (list/user)
    // Only import devices seen within the last 4 weeks
    try {
        const usersResponse = await unifiService.getAllUsers();
        const users = usersResponse?.data || usersResponse || [];
        if (Array.isArray(users)) {
            const fourWeeksAgo = Math.floor(Date.now() / 1000) - (28 * 24 * 60 * 60);

            for (const user of users) {
                if (!user.mac) continue;

                // Filter: only include users seen within the last 4 weeks
                // UniFi stores last_seen as epoch seconds
                const lastSeen = user.last_seen || 0;
                if (lastSeen < fourWeeksAgo) continue;

                // Only insert if not already known
                // (don't overwrite fresh stat/sta data)
                const cleaned = normaliseMac(user.mac);
                const existing = db.prepare(
                    'SELECT id FROM discovered_devices WHERE mac_address = ?'
                ).get(cleaned);

                if (!existing) {
                    const segment = findSegmentForIp(user.last_ip || user.ip);
                    upsertDevice({
                        mac: user.mac,
                        ip: user.last_ip || user.ip || null,
                        hostname: user.hostname || user.name || null,
                        is_wired: user.is_wired ? 1 : 0,
                        source: 'unifi_historical',
                        segment_id: segment?.id || null
                    });
                    results.historical++;
                }
            }
        }
    } catch (err) {
        results.errors.push('list/user: ' + err.message);
    }

    console.log(
        `[Discovery] UniFi harvest: ${results.wifi} WiFi, ` +
        `${results.wired} wired, ${results.historical} historical`
    );
    return results;
}

// ─── Source 2: nmap ARP Scan ────────────────────────────────────────

/**
 * Parse nmap greppable (-oG) output.
 * Also handles normal nmap output where MAC lines appear after Host lines.
 */
function parseNmapOutput(output) {
    const entries = [];
    const lines = output.split('\n');

    // Pass 1: Find Host lines with status Up
    const hostMap = {};
    let lastUpHost = null;

    for (const line of lines) {
        // Greppable: Host: 192.168.1.1 (hostname) Status: Up
        const greppableHost = line.match(
            /^Host:\s+(\d+\.\d+\.\d+\.\d+)\s+\(([^)]*)\)\s+Status:\s+Up/
        );
        if (greppableHost) {
            hostMap[greppableHost[1]] = greppableHost[2] || null;
            lastUpHost = greppableHost[1];
            continue;
        }

        // Normal output: Nmap scan report for hostname (ip) or just (ip)
        const normalHost = line.match(
            /Nmap scan report for\s+(?:(\S+)\s+)?\((\d+\.\d+\.\d+\.\d+)\)/
        );
        if (normalHost) {
            hostMap[normalHost[2]] = normalHost[1] || null;
            lastUpHost = normalHost[2];
            continue;
        }

        // Normal output: Nmap scan report for 192.168.1.1
        const simpleHost = line.match(
            /Nmap scan report for\s+(\d+\.\d+\.\d+\.\d+)/
        );
        if (simpleHost) {
            hostMap[simpleHost[1]] = null;
            lastUpHost = simpleHost[1];
            continue;
        }

        // MAC Address line: MAC Address: AA:BB:CC:DD:EE:FF (Vendor)
        const macLine = line.match(
            /MAC Address:\s+([0-9A-Fa-f:]{17})/
        );
        if (macLine && lastUpHost) {
            entries.push({
                ip: lastUpHost,
                mac: macLine[1],
                hostname: hostMap[lastUpHost] || null
            });
            lastUpHost = null; // consumed
        }
    }

    return entries.filter(e => e.mac && e.ip);
}

/**
 * Run nmap ARP ping scan on a CIDR range using a specific interface.
 * -sn: no port scan (host discovery only)
 * -PR: ARP ping only
 * --interface: use specific network interface
 */
async function runNmapArpScan(cidr, iface, io) {
    try {
        const cmd = `nmap -sn -PR --interface ${iface} ${cidr}`;

        if (io) {
            io.emit('discovery:arp_progress', { stage: 'nmap_running', cidr });
        }

        console.log(`[Discovery] Running: ${cmd}`);
        const { stdout } = await execAsync(cmd, { timeout: 120000 }); // 2 min max
        return parseNmapOutput(stdout);
    } catch (err) {
        console.error('[Discovery] nmap scan error:', err.message);
        return [];
    }
}

/**
 * Parse `ip neigh show` output.
 * Format: 192.168.1.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE
 */
function parseIpNeigh(output) {
    const entries = [];
    for (const line of output.split('\n')) {
        const match = line.match(
            /^(\d+\.\d+\.\d+\.\d+)\s+dev\s+\S+\s+lladdr\s+([0-9a-fA-F:]{17})\s+(\w+)/
        );
        if (!match) continue;
        if (match[3] === 'FAILED') continue;
        entries.push({
            ip: match[1],
            mac: match[2],
            hostname: null,
            state: match[3]
        });
    }
    return entries.filter(e =>
        e.mac && !isIgnoredMac(normaliseMac(e.mac))
    );
}

/**
 * Read ip neigh (Linux ARP cache), filtered to a CIDR range.
 * Used as a supplement to nmap — catches entries nmap may have missed.
 */
async function readIpNeigh(cidr) {
    try {
        const { stdout } = await execAsync('ip neigh show');
        const entries = parseIpNeigh(stdout);
        const block = new Netmask(cidr);
        return entries.filter(e => {
            try { return block.contains(e.ip); }
            catch { return false; }
        });
    } catch (err) {
        console.warn('[Discovery] ip neigh failed:', err.message);
        return [];
    }
}

/**
 * Parse `arp -a` output.
 * Linux/Alpine: hostname (ip) at mac [ether] on iface
 */
function parseArpA(output) {
    const entries = [];
    for (const line of output.split('\n')) {
        const ipMatch = line.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        const macMatch = line.match(/([0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2}[:\-][0-9a-fA-F]{2})/);
        const hostMatch = line.match(/^(\S+)\s+\(/);

        if (ipMatch && macMatch) {
            entries.push({
                hostname: (hostMatch && hostMatch[1] !== '?') ? hostMatch[1] : null,
                ip: ipMatch[1],
                mac: macMatch[1].replace(/-/g, ':').toLowerCase()
            });
        }
    }
    return entries.filter(e =>
        e.mac && e.ip && !isIgnoredMac(normaliseMac(e.mac))
    );
}

/**
 * Read arp -a (legacy fallback), filtered to a CIDR range.
 */
async function readArpA(cidr) {
    try {
        const { stdout } = await execAsync('arp -a');
        const entries = parseArpA(stdout);
        const block = new Netmask(cidr);
        return entries.filter(e => {
            try { return block.contains(e.ip); }
            catch { return false; }
        });
    } catch (err) {
        console.warn('[Discovery] arp -a failed:', err.message);
        return [];
    }
}

/**
 * Main ARP scan orchestrator.
 * 
 * Auto-detects the server's L2 segment and scans it using the best
 * available tool: nmap (primary) → ip neigh (supplement) → arp -a (fallback).
 * 
 * @param {object} io - Socket.IO server instance for emitting progress events
 */
async function arpScanL2Segment(io) {
    if (arpScanRunning) {
        throw new Error('ARP scan already in progress');
    }

    const capability = await checkDiscoveryCapability();

    // Hard stop if environment cannot do ARP
    if (!capability.can_arp_scan) {
        return {
            success: false,
            reason: capability.platform_note || 'ARP scan not available',
            macs_found: 0
        };
    }

    const l2 = capability.l2_segment;
    console.log(`[Discovery] ARP scan starting on ${l2.cidr} (${l2.segment}) via ${l2.interface}`);

    arpScanRunning = true;
    const discovered = [];

    try {
        // Emit scan started
        if (io) {
            io.emit('discovery:arp_started', {
                cidr: l2.cidr,
                segment: l2.segment,
                segment_id: l2.segment_id
            });
        }

        let arpEntries = [];

        // PRIMARY — nmap ARP ping scan
        if (capability.nmap_available) {
            arpEntries = await runNmapArpScan(l2.cidr, l2.interface, io);
            console.log(`[Discovery] nmap found ${arpEntries.length} devices`);
        }

        // SUPPLEMENT — ip neigh adds cache entries nmap may have missed
        if (capability.ip_neigh_available) {
            if (io) {
                io.emit('discovery:arp_progress', { stage: 'ip_neigh', cidr: l2.cidr });
            }
            const neighEntries = await readIpNeigh(l2.cidr);
            for (const entry of neighEntries) {
                const mac = normaliseMac(entry.mac);
                if (!mac) continue;
                const exists = arpEntries.find(e => normaliseMac(e.mac) === mac);
                if (!exists) {
                    arpEntries.push(entry);
                    console.log(`[Discovery] ip neigh added: ${entry.ip} ${entry.mac}`);
                }
            }
        }

        // FALLBACK — arp -a if nothing else found anything
        if (arpEntries.length === 0 && capability.arp_available) {
            if (io) {
                io.emit('discovery:arp_progress', { stage: 'arp_fallback', cidr: l2.cidr });
            }
            arpEntries = await readArpA(l2.cidr);
            console.log(`[Discovery] arp -a fallback found ${arpEntries.length}`);
        }

        // Upsert all discovered devices
        const scanResultsForMerge = [];

        for (const entry of arpEntries) {
            const mac = normaliseMac(entry.mac);
            if (!mac || isIgnoredMac(mac)) continue;
            // Skip the server's own MAC
            if (entry.ip === l2.ip) continue;

            upsertDevice({
                mac: entry.mac,
                ip: entry.ip,
                hostname: entry.hostname || null,
                is_wired: 1,
                source: 'arp_scan',
                segment_id: l2.segment_id
            });

            scanResultsForMerge.push({
                ip: entry.ip,
                status: 'up',
                latency_ms: 1,
                hostname: entry.hostname || null
            });

            discovered.push(entry);
        }

        // Save to scan_results so mergeService picks it up for "Online Now"
        if (l2.segment_id && scanResultsForMerge.length > 0) {
            try {
                db.prepare(`
                    INSERT INTO scan_results (segment_id, hosts_found, hosts_up, raw_json)
                    VALUES (?, ?, ?, ?)
                `).run(l2.segment_id, scanResultsForMerge.length, scanResultsForMerge.length, JSON.stringify(scanResultsForMerge));
            } catch (e) {
                console.error('[Discovery] Failed to save ARP scan to scan_results:', e.message);
            }
        }

        // Emit completion
        if (io) {
            io.emit('discovery:arp_complete', {
                cidr: l2.cidr,
                segment: l2.segment,
                segment_id: l2.segment_id,
                macs_found: discovered.length
            });
        }

        console.log(`[Discovery] ARP scan complete: ${discovered.length} devices on ${l2.cidr}`);

        return {
            success: true,
            cidr: l2.cidr,
            segment: l2.segment,
            segment_id: l2.segment_id,
            macs_found: discovered.length,
            entries: discovered
        };

    } finally {
        arpScanRunning = false;
    }
}

// ─── Exports ────────────────────────────────────────────────────────

module.exports = {
    checkDiscoveryCapability,
    getServerL2Segment,
    harvestUnifiClients,
    arpScanL2Segment,
    isArpScanRunning,
    upsertDevice,
    findSegmentForIp,
    normaliseMac,
    getMacTrackingStats,
    resetMacTrackingStats
};
