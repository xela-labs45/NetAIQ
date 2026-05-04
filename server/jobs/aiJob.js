const { detectAnomalies, summariseAlerts, getAiStatus } = require('../services/aiService');
const { ouiIdentifyUnprocessed } = require('../services/discoveryService');
const db = require('../db/database');
const settingsService = require('../services/settingsService');

let anomalyTimer = null;
let triageTimer = null;
let anomalyRunning = false;
let triageRunning = false;
let lastTriageUnreadCount = null;

function isBusinessHours() {
  const hour = new Date().getHours();
  return hour >= 7 && hour < 19;
}

function shouldRun(scheduleKey) {
  const schedule = settingsService.get(scheduleKey) || 'always';
  if (schedule === 'disabled') return false;
  if (schedule === 'business_hours') return isBusinessHours();
  return true; // 'always'
}

function getUnreadAlertCount() {
  return db.prepare('SELECT COUNT(*) as count FROM alerts WHERE is_read = 0').get()?.count || 0;
}

function startAiJobs(fastify) {
  // Reset tracking state on restart
  lastTriageUnreadCount = null;

  // Read intervals from settings (in minutes), convert to ms. Fallback 10m / 5m.
  const anomalyMins = parseInt(settingsService.get('ai_anomaly_interval') || '10', 10);
  const triageMins = parseInt(settingsService.get('ai_triage_interval') || '5', 10);

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
  // then every 5 minutes for newly discovered ones.
  setTimeout(() => {
    try {
      const count = ouiIdentifyUnprocessed();
      if (count > 0) fastify.io.emit('discovery:oui_identified', { count });
    } catch (e) { console.error('OUI startup job error:', e.message); }
  }, 5000);

  setInterval(() => {
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

  // Background jobs also check schedule settings
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
  startAiJobs(fastify);
  console.log('AI jobs restarted with new intervals');
}


/**
 * Force a triage run (from the UI button). Bypasses delta tracking.
 */
async function forceTriageRun(fastify) {
  return await runTriageJob(fastify, true);
}

module.exports = { startAiJobs, restartAiJobs, forceTriageRun, runTriageJob };
