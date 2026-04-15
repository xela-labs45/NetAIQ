const db = require('../db/database');
const { pingDevice } = require('../services/pingService');
const pLimit = require('p-limit');
const escalatingPollManager = require('../services/EscalatingPollManager');

let currentTimer = null;
let isRunning = false;
let nextRunTime = null;

function getInterval() {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('critical_ping_interval');
    return (parseInt(setting?.value || '120', 10) * 1000); // converting to ms
}

async function runPingCycle(fastify) {
    if (isRunning) return;
    isRunning = true;

    try {
        // Fetch only critical devices that are NOT currently being actively managed by the escalating poll manager
        const criticalDevices = db.prepare('SELECT * FROM devices WHERE is_critical = 1').all();
        const devicesToPing = criticalDevices.filter(d => !escalatingPollManager.isEscalating(d.id));

        if (devicesToPing.length > 0) {
            fastify.log.info(`Critical Ping cycle running for ${devicesToPing.length} devices (${criticalDevices.length - devicesToPing.length} skipped due to escalation).`);
            
            const limit = pLimit(5); // Process in batches of 5
            const tasks = devicesToPing.map(device => limit(async () => {
                // BUG 1 & 5 FIX: Re-check escalation status just before pinging
                // This prevents race conditions if the device started escalating after the cycle began.
                if (escalatingPollManager.isEscalating(device.id)) {
                    return;
                }

                let retries = 2;
                while (retries >= 0) {
                    try {
                        await pingDevice(device, fastify);
                        return;
                    } catch (err) {
                        if (retries === 0) {
                            fastify.log.error(`Critical device ${device.hostname || device.ip_address} ping failed: ${err.message}`);
                        } else {
                            await new Promise(res => setTimeout(res, 1000));
                        }
                        retries--;
                    }
                }
            }));

            await Promise.allSettled(tasks);
        }
    } catch (err) {
        fastify.log.error(`Critical Ping cycle error: ${err.message}`);
    } finally {
        isRunning = false;
        scheduleNext(fastify);
    }
}

function scheduleNext(fastify) {
    if (currentTimer) clearTimeout(currentTimer);
    
    // Interval might have been updated during the run
    const intervalMs = getInterval();
    nextRunTime = Date.now() + intervalMs;
    
    currentTimer = setTimeout(() => {
        runPingCycle(fastify);
    }, intervalMs);
}

module.exports = {
    start: function(fastify) {
        fastify.log.info('Starting criticalPingJob scheduler...');
        if (currentTimer) clearTimeout(currentTimer);
        // Start immediately
        runPingCycle(fastify);
    },
    stop: function() {
        if (currentTimer) {
            clearTimeout(currentTimer);
            currentTimer = null;
        }
        nextRunTime = null;
    },
    getStatus: function() {
        return {
            running: currentTimer !== null,
            isExecuting: isRunning,
            nextRunExpectedAt: nextRunTime
        };
    }
};
