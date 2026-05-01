/**
 * mergeService.js
 * Merges online device data from three sources:
 *   A) UniFi clients (stat/sta)
 *   B) Segment scan results (latest per segment)
 *   C) Ping history (recent pings joined with devices table)
 *
 * Deduplicates by IP address. Priority: UniFi → scan → ping.
 */

const db = require('../db/database');
const unifiService = require('./unifiService');
const { lookupMac } = require('./macOuiService');
const { toSqliteTimestamp } = require('../utils/dateFormatter');

/**
 * Merge all online device sources into a deduplicated list keyed by IP.
 * @returns {Array<Object>} merged device entries
 */
async function mergeOnlineDevices() {
    const merged = new Map();

    // ── Source A: UniFi clients ──────────────────────────────────
    try {
        const clientData = await unifiService.getClients();
        const clients = clientData?.data || [];

        for (const c of clients) {
            if (!c.ip) continue; // skip clients without an IP

            merged.set(c.ip, {
                ip: c.ip,
                mac: c.mac || null,
                hostname: c.hostname || c.name || null,
                source: 'unifi',
                is_wired: c.is_wired || false,
                is_critical: false,
                segment_id: null,
                segment_name: null,
                tx_bytes: c.tx_bytes || 0,
                rx_bytes: c.rx_bytes || 0,
                latency_ms: null,
                signal: c.signal || null,
                essid: c.essid || null,
                last_seen: c.last_seen ? new Date(c.last_seen * 1000).toISOString() : null,
                uptime: c.uptime || null,
            });
        }
    } catch (err) {
        // UniFi may not be configured — continue with other sources
        console.log('mergeService: UniFi client fetch skipped:', err.message);
    }

    // ── Source B: Segment scan results ───────────────────────────
    try {
        // Get the latest scan per segment
        const latestScans = db.prepare(`
            SELECT sr.* FROM scan_results sr
            INNER JOIN (
                SELECT segment_id, MAX(scanned_at) as max_scanned 
                FROM scan_results 
                GROUP BY segment_id
            ) latest ON sr.segment_id = latest.segment_id 
                     AND sr.scanned_at = latest.max_scanned
        `).all();

        // Get segment names for enrichment
        const segmentMap = new Map();
        const segments = db.prepare('SELECT id, name FROM segments').all();
        for (const s of segments) {
            segmentMap.set(s.id, s.name);
        }

        for (const scan of latestScans) {
            let hosts = [];
            try {
                hosts = JSON.parse(scan.raw_json || '[]');
            } catch (e) { /* invalid json, skip */ }

            for (const host of hosts) {
                if (!host.ip) continue;

                if (merged.has(host.ip)) {
                    // Enrich existing entry with latency from scan, don't overwrite
                    const existing = merged.get(host.ip);
                    if (host.latency_ms != null && existing.latency_ms == null) {
                        existing.latency_ms = host.latency_ms;
                    }
                    if (!existing.segment_id) {
                        existing.segment_id = scan.segment_id;
                        existing.segment_name = segmentMap.get(scan.segment_id) || null;
                    }
                } else if (host.status === 'up') {
                    // New entry from scan
                    merged.set(host.ip, {
                        ip: host.ip,
                        mac: null,
                        hostname: null,
                        source: 'scan',
                        is_wired: true, // assumed wired — UniFi would detect wireless
                        is_critical: false,
                        segment_id: scan.segment_id,
                        segment_name: segmentMap.get(scan.segment_id) || null,
                        tx_bytes: null,
                        rx_bytes: null,
                        latency_ms: host.latency_ms || null,
                        signal: null,
                        essid: null,
                        last_seen: scan.scanned_at,
                        uptime: null,
                    });
                }
            }
        }
    } catch (err) {
        console.log('mergeService: scan results fetch error:', err.message);
    }

    // ── Source C: Ping history (recent, < 5 min) ────────────────
    try {
        const fiveMinAgo = toSqliteTimestamp(new Date(Date.now() - 5 * 60 * 1000));

        const recentPings = db.prepare(`
            SELECT d.id as device_id, d.hostname, d.ip_address, d.mac_address,
                   d.is_critical, d.segment_id,
                   s.name as segment_name,
                   ph.status, ph.latency_ms, ph.timestamp as last_seen
            FROM devices d
            INNER JOIN ping_history ph ON ph.device_id = d.id
            LEFT JOIN segments s ON d.segment_id = s.id
            WHERE ph.id = (
                SELECT ph2.id FROM ping_history ph2 
                WHERE ph2.device_id = d.id 
                ORDER BY ph2.timestamp DESC LIMIT 1
            )
            AND ph.timestamp >= ?
        `).all(fiveMinAgo);

        for (const row of recentPings) {
            if (!row.ip_address) continue;

            if (merged.has(row.ip_address)) {
                // Enrich existing: set is_critical, fill hostname if empty
                const existing = merged.get(row.ip_address);
                if (row.is_critical) existing.is_critical = true;
                if (!existing.hostname && row.hostname) existing.hostname = row.hostname;
                if (!existing.mac && row.mac_address) existing.mac = row.mac_address;
                if (!existing.segment_id && row.segment_id) {
                    existing.segment_id = row.segment_id;
                    existing.segment_name = row.segment_name;
                }
                if (existing.latency_ms == null && row.latency_ms != null) {
                    existing.latency_ms = row.latency_ms;
                }
            } else if (row.status === 'up') {
                // New entry from ping
                merged.set(row.ip_address, {
                    ip: row.ip_address,
                    mac: row.mac_address || null,
                    hostname: row.hostname || null,
                    source: 'ping',
                    is_wired: true, // assumed wired — UniFi would detect wireless
                    is_critical: row.is_critical === 1,
                    segment_id: row.segment_id || null,
                    segment_name: row.segment_name || null,
                    tx_bytes: null,
                    rx_bytes: null,
                    latency_ms: row.latency_ms || null,
                    signal: null,
                    essid: null,
                    last_seen: row.last_seen,
                    uptime: null,
                });
            }
        }
    } catch (err) {
        console.log('mergeService: ping history fetch error:', err.message);
    }

    // ── Determine is_registered ──────────────────────────────────────
    const registeredDevices = db.prepare('SELECT ip_address, mac_address FROM devices').all();
    const registeredIps = new Set(registeredDevices.map(d => d.ip_address).filter(Boolean));
    const registeredMacs = new Set(registeredDevices.map(d => d.mac_address?.toLowerCase()).filter(Boolean));

    const finalMerged = Array.from(merged.values()).map(device => {
        const isIpRegistered = device.ip && registeredIps.has(device.ip);
        const isMacRegistered = device.mac && registeredMacs.has(device.mac.toLowerCase());
        
        // Enrich with OUI vendor info if MAC is present
        if (device.mac) {
            const oui = lookupMac(device.mac);
            if (oui) {
                device.vendor = oui.manufacturer || device.vendor || null;
                // Only override device_type/os_guess if they are null
                if (!device.device_type) device.device_type = oui.device_type || null;
                if (!device.os_guess) device.os_guess = oui.os_guess || null;
            }
        }

        return {
            ...device,
            is_registered: isIpRegistered || isMacRegistered
        };
    });

    return finalMerged;
}

/**
 * Returns a summary count of online devices.
 * - total: all unique online IPs
 * - wired: is_wired === true (UniFi wired clients + non-UniFi devices assumed wired)
 * - wireless: is_wired === false (UniFi wireless clients)
 * - unifi_seen: total clients present in UniFi stat/sta
 */
async function getOnlineCount() {
    const devices = await mergeOnlineDevices();

    const total = devices.length;
    const wired = devices.filter(d => d.is_wired === true).length;
    const wireless = devices.filter(d => d.is_wired === false).length;
    const unifi_seen = devices.filter(d => d.source === 'unifi').length;

    return { total, wired, wireless, unifi_seen };
}

module.exports = {
    mergeOnlineDevices,
    getOnlineCount,
};
