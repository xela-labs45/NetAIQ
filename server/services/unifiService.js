const axios = require('axios');
const https = require('https');
const db = require('../db/database');

let sessionCache = {
    sessionCookie: null,
    csrfToken: null,
    expiresAt: 0
};

let dataCache = new Map();

function getSettings() {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    return settings.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
    }, {});
}

async function authenticate() {
    const settings = getSettings();
    const { unifi_url, unifi_username, unifi_password, unifi_ssl_verify } = settings;

    if (!unifi_url || !unifi_username || !unifi_password) {
        throw new Error('UniFi credentials not configured');
    }

    const httpsAgent = new https.Agent({
        rejectUnauthorized: unifi_ssl_verify === '1'
    });

    try {
        const response = await axios.post(`${unifi_url}/api/auth/login`, {
            username: unifi_username,
            password: unifi_password,
            rememberMe: false
        }, {
            headers: { 'Content-Type': 'application/json' },
            httpsAgent
        });

        const setCookieHeader = response.headers['set-cookie'];
        let cookieString = '';
        if (setCookieHeader && Array.isArray(setCookieHeader)) {
            cookieString = setCookieHeader.map(c => c.split(';')[0]).join('; ');
        } else if (setCookieHeader && typeof setCookieHeader === 'string') {
            cookieString = setCookieHeader.split(';')[0];
        }

        const csrfToken = response.headers['x-csrf-token'] || '';

        if (!cookieString) {
            throw new Error('Failed to extract session cookies from UniFi login');
        }

        sessionCache = {
            cookieString,
            csrfToken,
            expiresAt: Date.now() + 3600000 // 1 hour
        };

        return true;
    } catch (error) {
        console.error('UniFi Auth Error:', error.message);
        throw error;
    }
}

async function makeRequest(method, endpoint, data = null, retry = true) {
    if (Date.now() > sessionCache.expiresAt) {
        await authenticate();
    }

    const settings = getSettings();
    const { unifi_url, unifi_site, unifi_ssl_verify } = settings;
    const site = unifi_site || 'default';

    const url = `${unifi_url}/proxy/network/api/s/${site}${endpoint}`;

    const httpsAgent = new https.Agent({
        rejectUnauthorized: unifi_ssl_verify === '1'
    });

    const headers = {
        'Cookie': sessionCache.cookieString || '',
        'Content-Type': 'application/json'
    };
    if (sessionCache.csrfToken) {
        headers['X-CSRF-Token'] = sessionCache.csrfToken;
    }

    try {
        const config = { method, url, headers, httpsAgent };
        if (data) config.data = data;

        const response = await axios(config);
        return response.data;
    } catch (error) {
        if (error.response && error.response.status === 401 && retry) {
            // Re-auth and retry once
            await authenticate();
            return makeRequest(method, endpoint, data, false);
        }
        console.error(`UniFi API Error on ${endpoint}:`, error.message);
        return null;
    }
}

async function getFromCacheOrFetch(key, fetchFn) {
    const cached = dataCache.get(key);
    if (cached && (Date.now() - cached.cachedAt < 55000)) {
        return cached.data;
    }

    const data = await fetchFn();
    if (data) {
        dataCache.set(key, { data, cachedAt: Date.now() });
    }
    return data;
}

// ---------------------------------------------------------
// Exposed Methods
// ---------------------------------------------------------

async function getClients() {
    return getFromCacheOrFetch('clients', () => makeRequest('GET', '/stat/sta'));
}

async function getAllUsers() {
    return getFromCacheOrFetch('users', () => makeRequest('GET', '/list/user'));
}

async function getDevices() {
    return getFromCacheOrFetch('devices', () => makeRequest('GET', '/stat/device'));
}

async function getSiteHealth() {
    return getFromCacheOrFetch('health', () => makeRequest('GET', '/stat/health'));
}

async function buildMacNameMap() {
    return getFromCacheOrFetch('macNameMap', async () => {
        const [clientsResponse, usersResponse] = await Promise.all([
            getClients(),
            getAllUsers()
        ]);

        const map = {};

        // Source B: All users ever seen
        const users = usersResponse?.data || usersResponse || [];
        if (Array.isArray(users)) {
            users.forEach(u => {
                const mac = (u.mac || '').toLowerCase();
                if (mac) {
                    map[mac] = u.name || u.hostname || u.ip || u.mac;
                }
            });
        }

        // Source A: Currently connected clients (higher priority)
        const clients = clientsResponse?.data || clientsResponse || [];
        if (Array.isArray(clients)) {
            clients.forEach(c => {
                const mac = (c.mac || '').toLowerCase();
                if (mac) {
                    map[mac] = c.hostname || c.name || c.ip || c.mac;
                }
            });
        }

        return map;
    });
}

async function getDailyUserReport(mac, start, end) {
    const body = {
        attrs: ["tx_bytes", "rx_bytes", "mac", "time"],
        start,
        end
    };
    if (mac) {
        body.macs = [mac];
    }
    return makeRequest('POST', '/stat/report/daily.user', body);
}

async function getClientsUsage(start, end, type = 'daily') {
    const body = {
        attrs: ["tx_bytes", "rx_bytes", "mac"],
        start,
        end
    };
    const endpoint = type === 'weekly' ? '/stat/report/weekly.user' : '/stat/report/daily.user';
    return makeRequest('POST', endpoint, body);
}

async function getHourlySiteReport(start, end) {
    const body = {
        attrs: ["wan-tx_bytes", "wan-rx_bytes", "time"],
        start,
        end
    };
    const response = await makeRequest('POST', '/stat/report/hourly.site', body);

    let reportArray = null;
    if (Array.isArray(response)) {
        reportArray = response;
    } else if (Array.isArray(response?.data)) {
        reportArray = response.data;
    }

    if (!reportArray || reportArray.length === 0) {
        return [];
    }

    console.log('=== hourly.site first entry:', JSON.stringify(reportArray[0]));

    return reportArray.map(entry => ({
        time: entry.time || entry.datetime || entry.t,
        tx_bytes: entry['wan-tx_bytes'] || entry.wan_tx_bytes || entry.tx_bytes || 0,
        rx_bytes: entry['wan-rx_bytes'] || entry.wan_rx_bytes || entry.rx_bytes || 0
    }));
}

async function getWanStats() {
    try {
        const responseData = await getSiteHealth();

        // Step 1: Diagnostic Logging (Temporary)
        console.log('=== UniFi Health RAW DATA:', JSON.stringify(responseData, null, 2));

        // Step 2: Defensive Parsing
        let healthArray = null;

        if (Array.isArray(responseData)) {
            // Shape A: data is directly the array
            healthArray = responseData;
        } else if (responseData?.data && Array.isArray(responseData.data)) {
            // Shape B: data.data is the array
            healthArray = responseData.data;
        } else if (responseData?.health && Array.isArray(responseData.health)) {
            // Variant of Shape B
            healthArray = responseData.health;
        } else if (responseData?.data?.health && Array.isArray(responseData.data.health)) {
            // Shape C: nested under .health
            healthArray = responseData.data.health;
        }

        let wan = null;
        if (healthArray && healthArray.length > 0) {
            wan = healthArray.find(s =>
                s.subsystem === 'wan' ||
                s.subsystem === 'wan2' ||
                s.subsystem === 'gw'
            );
            console.log('=== All subsystems found:', healthArray.map(s => s.subsystem));
        }

        // Step 4: Fallback to /stat/device if health parsing fails
        if (!wan) {
            console.warn('UniFi health: no wan subsystem found, trying fallback to /stat/device');
            const devicesData = await getDevices();
            const devices = devicesData?.data || devicesData || [];
            if (Array.isArray(devices)) {
                const gateway = devices.find(d =>
                    d.type === 'ugw' || d.type === 'usg' || d.type === 'udm' || d.model?.includes('UDM') || d.model?.includes('USG')
                );

                if (gateway) {
                    console.log('=== Gateway device found for fallback:', gateway.name || gateway.mac);
                    const wanIp = gateway.wan1?.ip || gateway.config?.wan1?.ip || gateway.ip || null;
                    const txRate = gateway.uplink?.tx_bytes_r || 0;
                    const rxRate = gateway.uplink?.rx_bytes_r || 0;

                    return {
                        status: gateway.state === 1 ? 'up' : 'down',
                        wan_ip: wanIp,
                        tx_mbps: ((txRate * 8) / 1e6).toFixed(2),
                        rx_mbps: ((rxRate * 8) / 1e6).toFixed(2),
                        latency: gateway.uplink?.latency || null,
                        source: 'device_fallback'
                    };
                }
            }
        }

        if (!wan) {
            return { status: 'unknown', wan_ip: null, tx_mbps: '0.00', rx_mbps: '0.00' };
        }

        console.log('=== WAN subsystem found:', JSON.stringify(wan));

        // Field names vary across UniFi OS versions
        const wanIp = wan.wan_ip || wan.gw_addr || wan.ip || wan['wan-ip'] || null;
        const txRate = wan.tx_bytes_r || wan['tx-bytes-r'] || wan.txRate || 0;
        const rxRate = wan.rx_bytes_r || wan['rx-bytes-r'] || wan.rxRate || 0;

        // 'ok', 'connected', 'running', 'up' are all healthy statuses
        const isUp = ['ok', 'connected', 'running', 'up'].includes(wan.status?.toLowerCase());

        return {
            status: isUp ? 'up' : 'down',
            wan_ip: wanIp,
            tx_mbps: ((txRate * 8) / 1e6).toFixed(2),
            rx_mbps: ((rxRate * 8) / 1e6).toFixed(2),
            latency: wan.latency || wan.gw_latency || null,
            raw_status: wan.status,
            source: 'stat_health'
        };

    } catch (err) {
        console.error('getWanStats error:', err.message);
        return { status: 'unknown', wan_ip: null, tx_mbps: '0.00', rx_mbps: '0.00', error: err.message };
    }
}

module.exports = {
    getClients,
    getAllUsers,
    getDevices,
    getSiteHealth,
    getDailyUserReport,
    getClientsUsage,
    getHourlySiteReport,
    getWanStats,
    buildMacNameMap,
    authenticate
};
