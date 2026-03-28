const db = require('../db/database');
const {
  getAiStatus, testConnection, fetchModels, clearModelCache,
  identifyDevice, getUnidentifiedDevices, detectAnomalies, summariseAlerts
} = require('../services/aiService');
const { restartAiJobs } = require('../jobs/aiJob');

module.exports = async function (fastify, opts) {
  fastify.addHook('preValidation', fastify.authenticate);

  fastify.get('/status', async (request, reply) => {
    return getAiStatus();
  });

  fastify.post('/test-connection', async (request, reply) => {
    const { provider, api_key, model } = request.body;
    return testConnection(provider, api_key, model);
  });

  fastify.get('/models', async (request, reply) => {
    const { provider, api_key } = request.query;
    if (!provider) return reply.code(400).send({ error: 'Provider required' });

    let apiKey = api_key;
    if (!apiKey) {
      // Read key from DB if not provided in query
      if (provider === 'anthropic' || provider === 'claude') {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_anthropic_key');
        const fallback = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_claude_key');
        apiKey = row?.value || fallback?.value;
      } else {
        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('ai_openrouter_key');
        apiKey = row?.value;
      }
    }

    return fetchModels(provider, apiKey);
  });

  fastify.post('/models/refresh', async (request, reply) => {
    const { provider } = request.body;
    if (provider) {
      clearModelCache(provider);
      return { cleared: true };
    }
    return { cleared: false };
  });

  fastify.get('/anomalies', async (request, reply) => {
    const latest = db.prepare(`
      SELECT result_json, created_at
      FROM ai_analysis_history
      WHERE analysis_type = 'anomaly'
      ORDER BY created_at DESC LIMIT 1
    `).get();

    const isStale = !latest || Date.now() - new Date(latest?.created_at).getTime() > 5 * 60 * 1000;
    const forceRefresh = request.query.refresh === 'true';

    if (isStale || forceRefresh) {
      // Run in background
      setImmediate(async () => {
        try {
          await detectAnomalies(true);
          fastify.io.emit('ai:analysis_complete', { type: 'anomaly' });
        } catch (err) {
          fastify.io.emit('ai:analysis_error', { type: 'anomaly', message: err.message });
        }
      });
    }

    let parsedResult = null;
    if (latest && latest.result_json) {
      try {
        const parsed = JSON.parse(latest.result_json);
        // Flatten anomalies array for frontend compatibility (FIX 2B)
        if (parsed.anomalies && Array.isArray(parsed.anomalies)) {
          parsedResult = {
            ...parsed,
            anomalies: parsed.anomalies.map(anomaly => ({
              ...anomaly,
              analysis_text: `[${anomaly.severity?.toUpperCase()}] ${anomaly.title}: ${anomaly.description}`
            }))
          };
        } else {
          parsedResult = parsed;
        }
      } catch (err) {
        console.error('Failed to parse cached anomalies:', err.message);
      }
    }

    return reply.send({
      result: parsedResult,
      cached_at: latest?.created_at || null,
      refreshing: isStale || forceRefresh
    });
  });

  fastify.get('/alert-summary', async (request, reply) => {
    const latest = db.prepare(`
      SELECT result_json, created_at
      FROM ai_analysis_history
      WHERE analysis_type = 'alert_triage'
      ORDER BY created_at DESC LIMIT 1
    `).get();

    const isStale = !latest || Date.now() - new Date(latest?.created_at).getTime() > 2 * 60 * 1000;
    const forceRefresh = request.query.refresh === 'true';

    if (isStale || forceRefresh) {
      // Run in background
      setImmediate(async () => {
        try {
          await summariseAlerts(true);
          fastify.io.emit('ai:analysis_complete', { type: 'alert_triage' });
        } catch (err) {
          fastify.io.emit('ai:analysis_error', { type: 'alert_triage', message: err.message });
        }
      });
    }

    let parsedResult = null;
    if (latest && latest.result_json) {
      try {
        const parsed = JSON.parse(latest.result_json);
        // Ensure triage_groups patterns are mapped (FIX 2C)
        if (parsed.triage_groups && Array.isArray(parsed.triage_groups)) {
          parsedResult = {
            ...parsed,
            triage_groups: parsed.triage_groups.map(group => ({
              ...group,
              analysis_text: `[P${group.priority}] ${group.title}: ${group.pattern}`
            }))
          };
        } else {
          parsedResult = parsed;
        }
      } catch (err) {
        console.error('Failed to parse cached alert triage:', err.message);
      }
    }

    return reply.send({
      result: parsedResult,
      cached_at: latest?.created_at || null,
      refreshing: isStale || forceRefresh
    });
  });

  fastify.post('/identify-device', async (request, reply) => {
    const { device_id } = request.body;
    if (!device_id) return reply.code(400).send({ error: 'device_id required' });

    const result = await identifyDevice(device_id);

    if (result && result.error && result.rateLimited) {
      return reply.code(429).send({ error: 'Rate limited', resetIn: result.resetIn });
    }

    return result || reply.code(500).send({ error: 'Identification failed' });
  });

  fastify.get('/unidentified-devices', async (request, reply) => {
    return getUnidentifiedDevices();
  });

  fastify.post('/dismiss-noise', async (request, reply) => {
    const { alert_ids } = request.body;
    if (!Array.isArray(alert_ids) || alert_ids.length === 0) {
      return reply.code(400).send({ error: 'alert_ids array required' });
    }

    const placeholders = alert_ids.map(() => '?').join(',');
    const stmt = db.prepare(`UPDATE alerts SET is_read = 1 WHERE id IN(${placeholders})`);
    const info = stmt.run(...alert_ids);

    return { dismissed: info.changes };
  });

  fastify.get('/history', async (request, reply) => {
    const { type, limit } = request.query;
    const maxLimit = parseInt(limit, 10) || 10;

    if (type) {
      return db.prepare(`
        SELECT id, analysis_type, provider, model, health_score, anomaly_count, alert_count, urgent, created_at
        FROM ai_analysis_history
        WHERE analysis_type = ?
            ORDER BY created_at DESC LIMIT ?
            `).all(type, maxLimit);
    } else {
      return db.prepare(`
        SELECT id, analysis_type, provider, model, health_score, anomaly_count, alert_count, urgent, created_at
        FROM ai_analysis_history
        ORDER BY created_at DESC LIMIT ?
            `).all(maxLimit);
    }
  });

  fastify.post('/restart-jobs', async (request, reply) => {
    restartAiJobs(fastify);
    return { success: true };
  });
};
