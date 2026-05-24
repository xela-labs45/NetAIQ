const { detectAnomalies, summariseAlerts, getAiStatus } = require('../services/aiService');
const { ouiIdentifyUnprocessed } = require('../services/discoveryService');
const db = require('../db/database');
const settingsService = require('../services/settingsService');

let anomalyTimer = null;
let triageTimer = null;
let ouiTimer = null;
let ouiStartupTimer = null;
let anomalyRunning = false;
let triageRunning = false;
let lastTriageUnreadCount = null;

function isBusinessHours() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19;
}

function getSchedule(scheduleKey) {
  return settingsService.get(scheduleKey) || 'always';
}

function isScheduleDisabled(scheduleKey) {
  return getSchedule(scheduleKey) === 'disabled';
}

// True when the cron should fire right now (also honours business_hours).
function shouldRun(scheduleKey) {
  const schedule = getSchedule(scheduleKey);
  if (schedule === 'disabled') return false;
  if (schedule === 'business_hours') return isBusinessHours();
  return true; // 'always'
}

function getUnreadAlertCount() {
  return db.prepare('SELECT COUNT(*) as count FROM alerts WHERE is_read = 0').get()?.count || 0;
}

// Parse a minute-interval setting; clamp <=0 (or NaN) to null so the caller can
// skip scheduling entirely instead of calling setInterval(0).
function parseIntervalMins(value, fallback) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n <= 0) {
    if (value && String(value).trim() !== '') {
      console.warn(`AI cron interval ${JSON.stringify(value)} is invalid; using ${fallback}m`);
    }
    return fallback;
  }
  return n;
}

function startAiJobs(fastify) {
  // Reset tracking state on restart
  lastTriageUnreadCount = null;

  const anomalyMins = parseIntervalMins(settingsService.get('ai_anomaly_interval'), 10);
  const triageMins = parseIntervalMins(settingsService.get('ai_triage_interval'), 5);

  // Anomaly detection job
  anomalyTimer = setInterval(async () => {
    if (anomalyRunning) return;
    const status = getAiStatus();
    if (!status.available) return;
    if (!shouldRun('ai_anomaly_schedule')) return;

    anomalyRunning = true;
    try {
      await detectAnomalies(true);
      fastify.io.emit('ai:analysis_complete', { type: 'anomaly' });
    } catch (err) {
      console.error('Anomaly job error:', err.message);
      fastify.io.emit('ai:analysis_error', {
        type: 'anomaly',
        message: err.message
      });
    } finally {
      anomalyRunning = false;
    }
  }, anomalyMins * 60 * 1000);

  // Alert triage job — with delta tracking to skip unnecessary AI calls
  triageTimer = setInterval(async () => {
    await runTriageJob(fastify, false);
  }, triageMins * 60 * 1000);


  // OUI auto-identification: run at startup for existing unidentified devices,
  // then every 5 minutes for newly discovered ones. Both handles are tracked
  // so restartAiJobs() can clear them and avoid leaking timers.
  ouiStartupTimer = setTimeout(() => {
    try {
      const count = ouiIdentifyUnprocessed();
      if (count > 0) fastify.io.emit('discovery:oui_identified', { count });
    } catch (e) { console.error('OUI startup job error:', e.message); }
  }, 5000);

  ouiTimer = setInterval(() => {
    try {
      const count = ouiIdentifyUnprocessed();
      if (count > 0) fastify.io.emit('discovery:oui_identified', { count });
    } catch (e) { console.error('OUI periodic job error:', e.message); }
  }, 5 * 60 * 1000);

  console.log(`AI jobs started — anomaly: ${anomalyMins}min, triage: ${triageMins}min`);
}

/**
 * Core triage logic shared between cron and on-demand routes
 * @param {Object} fastify - Fastify instance
 * @param {Boolean} forced - If true, bypasses delta tracking (unread alert count)
 */
async function runTriageJob(fastify, forced = false) {
  if (triageRunning) return { skipped: true, reason: 'already_running' };

  const status = getAiStatus();
  if (!status.available) return { skipped: true, reason: 'ai_unavailable' };

  // 'disabled' is an explicit user preference — honour it even on manual runs.
  // Cron also skips during off-hours via shouldRun(); manual runs only check the disabled gate.
  if (isScheduleDisabled('ai_triage_schedule')) return { skipped: true, reason: 'schedule_disabled' };
  if (!forced && !shouldRun('ai_triage_schedule')) return { skipped: true, reason: 'scheduled_off' };

  const currentUnread = getUnreadAlertCount();

  // If not forced, check if we actually need to run (Delta Tracking)
  // RULE: Skip if no unread alerts exist, or if the unread count hasn't changed
  // since the last time the AI successfully analysed them.
  if (!forced) {
    if (currentUnread === 0) return { skipped: true, reason: 'no_unread' };
    if (lastTriageUnreadCount !== null && currentUnread === lastTriageUnreadCount) {
      console.log(`[AI Triage] Skipped — No new alerts since last analysis (unread: ${currentUnread})`);
      fastify.io.emit('ai:analysis_current', { type: 'alert_triage', unread: currentUnread });
      return { skipped: true, reason: 'no_viewer_delta' };
    }
  }

  triageRunning = true;
  try {
    // RULE: summarisAlerts(true) performs the actual LLM call
    await summariseAlerts(true);
    lastTriageUnreadCount = currentUnread;

    fastify.io.emit('ai:analysis_complete', { type: 'alert_triage' });
    return { skipped: false };
  } catch (err) {
    console.error('Triage job error:', err.message);
    fastify.io.emit('ai:analysis_error', { type: 'alert_triage', message: err.message });
    throw err;
  } finally {
    triageRunning = false;
  }
}

function restartAiJobs(fastify) {
  if (anomalyTimer) clearInterval(anomalyTimer);
  if (triageTimer) clearInterval(triageTimer);
  if (ouiTimer) clearInterval(ouiTimer);
  if (ouiStartupTimer) clearTimeout(ouiStartupTimer);
  startAiJobs(fastify);
  console.log('AI jobs restarted with new intervals');
}


/**
 * Force a triage run (from the UI button). Bypasses delta tracking.
 */
async function forceTriageRun(fastify) {
  return await runTriageJob(fastify, true);
}

module.exports = { startAiJobs, restartAiJobs, forceTriageRun, runTriageJob, isScheduleDisabled };
