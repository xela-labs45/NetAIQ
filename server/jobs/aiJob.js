const { detectAnomalies, summariseAlerts, getAiStatus } = require('../services/aiService');
const db = require('../db/database');
const settingsService = require('../services/settingsService');

let anomalyTimer = null;
let triageTimer = null;
let anomalyRunning = false;
let triageRunning = false;

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

function startAiJobs(fastify) {
  // Read intervals from settings (in minutes), convert to ms. Fallback 10m / 5m.
  const anomalyMins = parseInt(settingsService.get('ai_anomaly_interval') || '10', 10);
  const triageMins = parseInt(settingsService.get('ai_triage_interval') || '5', 10);

  // Anomaly detection job
  anomalyTimer = setInterval(async () => {
    if (anomalyRunning) return; // FIX 5
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

  // Alert triage job
  triageTimer = setInterval(async () => {
    if (triageRunning) return; // FIX 5
    const status = getAiStatus();
    if (!status.available) return;
    if (!shouldRun('ai_triage_schedule')) return;

    // Skip if no unread alerts
    const unread = db.prepare(`SELECT COUNT(*) as count FROM alerts WHERE is_read = 0`).get()?.count || 0;
    if (unread === 0) return;

    triageRunning = true;
    try {
      await summariseAlerts(true);
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

module.exports = { startAiJobs, restartAiJobs };
