const db = require('../db/database');
const { scanSegment } = require('../services/scanService');
const telegramService = require('../services/telegramService');
const alertService = require('../services/alertService');
const criticalPingJob = require('./criticalPingJob'); // to check if it's executing

let currentTimer = null;
let isRunning = false;
let nextRunTime = null;
// Map<segmentId, { since: number, telegramNotifiedAt: number|null, emailNotifiedAt: number|null }>
let segmentZeroTracker = new Map();

function getGraceMs(channel) {
    const key = channel === 'email' ? 'email_offline_grace_minutes' : 'telegram_offline_grace_minutes';
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return Math.max(0, parseInt(row?.value || '0', 10)) * 60 * 1000;
}

function getInterval() {
    const setting = db.prepare('SELECT value FROM settings WHERE key = ?').get('segment_scan_interval');
    return (parseInt(setting?.value || '900', 10) * 1000); // converting to ms
}

async function runScanCycle(fastify) {
    if (isRunning) return;
    
    // Check if critical ping is running, if so, delay by 5 seconds
    if (criticalPingJob.getStatus && criticalPingJob.getStatus().isExecuting) {
        fastify.log.info('Segment scan delayed because critical ping scan is currently executing.');
        currentTimer = setTimeout(() => runScanCycle(fastify), 5000);
        return;
    }

    isRunning = true;
    fastify.log.info('Running scheduled segment scan job...');

    try {
        const segments = db.prepare('SELECT id FROM segments').all();

        for (const seg of segments) {
            // Wait for critical ping to finish, capped at 60s to avoid permanent stall
            if (criticalPingJob.getStatus && criticalPingJob.getStatus().isExecuting) {
                fastify.log.info(`Pausing segment scan before segment ${seg.id} because critical ping started.`);
                const deadline = Date.now() + 60000;
                while (criticalPingJob.getStatus().isExecuting && Date.now() < deadline) {
                    await new Promise(res => setTimeout(res, 5000));
                }
                if (criticalPingJob.getStatus().isExecuting) {
                    fastify.log.warn('Critical ping still running after 60s — proceeding with segment scan anyway.');
                }
            }

            try {
                fastify.log.info(`Background scanning segment ${seg.id}...`);
                const results = await scanSegment(seg.id, fastify);

                // Telegram: check for offline segment (0 hosts up, but devices exist in DB)
                try {
                    const expectedDevices = db.prepare('SELECT COUNT(*) as count FROM devices WHERE segment_id = ?').get(seg.id).count;
                    const hostsUp = results.filter(r => r.status === 'up').length;

                    if (hostsUp === 0 && expectedDevices > 0) {
                        const now = Date.now();
                        const segment = db.prepare('SELECT name, cidr FROM segments WHERE id = ?').get(seg.id);

                        if (!segmentZeroTracker.has(seg.id)) {
                            // First time seeing this segment at zero — start grace period
                            segmentZeroTracker.set(seg.id, {
                                since: now,
                                telegramNotifiedAt: null,
                                emailNotifiedAt: null
                            });
                        }

                        const state = segmentZeroTracker.get(seg.id);

                        if (state.telegramNotifiedAt === null) {
                            const tgGraceMs = getGraceMs('telegram');
                            if (now - state.since >= tgGraceMs) {
                                state.telegramNotifiedAt = now;
                                fastify.log.warn(`Segment ${seg.id} offline (expected ${expectedDevices}, found 0). Sending Telegram alert.`);
                                telegramService.sendSegmentOffline(segment, expectedDevices, hostsUp);
                            }
                        }

                        if (state.emailNotifiedAt === null) {
                            const emailGraceMs = getGraceMs('email');
                            if (now - state.since >= emailGraceMs) {
                                state.emailNotifiedAt = now;
                                const segEmailPref = db.prepare("SELECT value FROM settings WHERE key = 'email_alert_segment_offline'").get();
                                if (segEmailPref?.value === '1') {
                                    fastify.log.warn(`Segment ${seg.id} offline. Sending email alert.`);
                                    alertService.sendEmailAlert({
                                        alert_type: 'segment_offline',
                                        message: `Network segment "${segment.name}" (${segment.cidr}) is unreachable. Expected ${expectedDevices} devices, found 0.`,
                                        severity: 'critical'
                                    });
                                }
                            }
                        }
                    } else if (hostsUp > 0) {
                        segmentZeroTracker.delete(seg.id);
                    }
                } catch (tgErr) {
                    fastify.log.error(`Segment ${seg.id} Telegram check error (non-blocking): ${tgErr.message}`);
                }

            } catch (err) {
                if (err.message !== 'A scan is already in progress.') {
                    fastify.log.error(`Segment ${seg.id} scheduled scan error: ${err.message}`);
                }
            }
        }
        fastify.log.info(`Segment scan job completed for ${segments.length} segments.`);
    } catch (err) {
        fastify.log.error(`Segment scan job error: ${err.message}`);
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
        runScanCycle(fastify);
    }, intervalMs);
}

module.exports = {
    start: function(fastify) {
        fastify.log.info('Starting segmentScanJob scheduler...');
        if (currentTimer) clearTimeout(currentTimer);
        // Start immediately
        runScanCycle(fastify);
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
            running: currentTimer !== null || isRunning,
            isExecuting: isRunning,
            nextRunExpectedAt: nextRunTime
        };
    }
};
