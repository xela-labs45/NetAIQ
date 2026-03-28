const { detectAnomalies, summariseAlerts, getAiStatus } = require('../services/aiService');
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
    if (triageRunning) return;
    const status = getAiStatus();
    if (!status.available) return;
    if (!shouldRun('ai_triage_schedule')) return;

    const currentUnread = getUnreadAlertCount();

    // Skip if no unread alerts at all
    if (currentUnread === 0) return;

    // Skip if unread count hasn't changed since last triage run
    if (lastTriageUnreadCount !== null && currentUnread === lastTriageUnreadCount) {
      console.log(`[AI Triage] Skipped — No new alerts since last analysis (unread: ${currentUnread})`);
      fastify.io.emit('ai:analysis_current', { type: 'alert_triage', unread: currentUnread });
      return;
    }

    triageRunning = true;
    try {
      await summariseAlerts(true);
      lastTriageUnreadCount = currentUnread;
      fastify.io.emit('ai:analysis_complete', { type: 'alert_triage' });
    } catch (err) {
      console.error('Triage job error:', err.message);
      fastify.io.emit('ai:analysis_error', {
        type: 'alert_triage',
        message: err.message
      });
    } finally {
      triageRunning = false;
    }
  }, triageMins * 60 * 1000);

  console.log(`AI jobs started — anomaly: ${anomalyMins}min, triage: ${triageMins}min`);
}

function restartAiJobs(fastify) {
  if (anomalyTimer) clearInterval(anomalyTimer);
  if (triageTimer) clearInterval(triageTimer);
  startAiJobs(fastify);
  console.log('AI jobs restarted with new intervals');
}

/**
 * Force a triage run (from the UI button). Bypasses delta tracking
 * so the AI always runs when explicitly requested.
 */
async function forceTriageRun(fastify) {
  if (triageRunning) return { skipped: true, reason: 'already_running' };
  const status = getAiStatus();
  if (!status.available) return { skipped: true, reason: 'ai_unavailable' };

  triageRunning = true;
  try {
    await summariseAlerts(true);
    lastTriageUnreadCount = getUnreadAlertCount();
    fastify.io.emit('ai:analysis_complete', { type: 'alert_triage' });
    return { skipped: false };
  } catch (err) {
    console.error('Forced triage error:', err.message);
    fastify.io.emit('ai:analysis_error', { type: 'alert_triage', message: err.message });
    throw err;
  } finally {
    triageRunning = false;
  }
}

module.exports = { startAiJobs, restartAiJobs, forceTriageRun };
