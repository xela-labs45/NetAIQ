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

async function getDailyUserReport(mac, start, end) {
    const body = {
        attrs: ["tx_bytes", "rx_bytes", "time"],
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
        attrs: ["tx_bytes", "rx_bytes"],
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
    return makeRequest('POST', '/stat/report/hourly.site', body);
}

async function getWanStats() {
    // Note: getSiteHealth() returns { data: [ { subsystem: 'wan', ... }, ... ] }
    // which means the actual array is inside response.data.data
    const response = await getSiteHealth();
    if (!response || !response.data) {
        return { status: 'unknown', wan_ip: null, tx_mbps: '0.00', rx_mbps: '0.00' };
    }

    const health = Array.isArray(response.data) ? response.data : response.data.data;
    if (!health || !Array.isArray(health)) {
        return { status: 'unknown', wan_ip: null, tx_mbps: '0.00', rx_mbps: '0.00' };
    }

    const wan = health.find(s => s.subsystem === 'wan');

    return {
        status: wan?.status === 'ok' ? 'up' : 'down',
        wan_ip: wan?.wan_ip || wan?.gw_addr || null,
        tx_mbps: wan ? ((wan.tx_bytes_r || 0) * 8 / 1e6).toFixed(2) : '0.00',
        rx_mbps: wan ? ((wan.rx_bytes_r || 0) * 8 / 1e6).toFixed(2) : '0.00',
        latency: wan?.latency || null,
        uptime: wan?.uptime || null
    };
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
    authenticate
};
