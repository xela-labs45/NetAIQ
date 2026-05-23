const { Anthropic } = require('@anthropic-ai/sdk');
const { lookupMac, normaliseMac } = require('./macOuiService');
const db = require('../db/database');
const settingsService = require('./settingsService');

// In-memory cache for analysis results
const cache = new Map();
const CACHE_TTL = {
  anomalies: 5 * 60 * 1000,   // 5 minutes
  alert_triage: 2 * 60 * 1000,   // 2 minutes
  db_fallback: 30 * 60 * 1000,   // 30 min cold start
};

const LIMITS = {
  identify_device_per_min: 3,
  identify_device_global_per_min: 20,
  max_retries: 3
};

// In-memory rate limiting map
const rateMap = new Map();

// Periodic cleanup of rateMap to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateMap.entries()) {
    // Arbitrary window sizes max out around a few minutes, clean up anything older than 10 mins
    if (now - entry.windowStart > 600000) {
      rateMap.delete(key);
    }
  }
}, 600000); // run every 10 mins

// In-memory model cache
const modelCache = new Map();
const MODEL_CACHE_TTL = 3600000;   // 1 hour

// Single-flight guards. Shared across cron and on-demand callers so double-clicking
// "Run Full Analysis" while a cron tick is in flight cannot fan out parallel LLM calls.
let anomalyInFlight = false;
let triageInFlight = false;

// SQLite CURRENT_TIMESTAMP returns 'YYYY-MM-DD HH:MM:SS' in UTC with no zone marker.
// new Date() parses that as local time, so cache-freshness math drifts by the host UTC offset.
// Same convention as alertService.js:82 and pingService.js:150.
function parseSqliteTs(s) {
  if (!s) return NaN;
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    try {
      // Find JSON array or object
      const match = text.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
      return match ? JSON.parse(match[0]) : null;
    } catch {
      console.warn('AI JSON parse failed:', text.slice(0, 200));
      return null;
    }
  }
}

function checkRateLimit(key, maxCalls = 5, windowMs = 60000) {
  const now = Date.now();
  const entry = rateMap.get(key) || { count: 0, windowStart: now };

  if (now - entry.windowStart > windowMs) {
    rateMap.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxCalls - 1 };
  }

  if (entry.count >= maxCalls) {
    const resetIn = Math.ceil((entry.windowStart + windowMs - now) / 1000);
    return { allowed: false, resetIn };
  }

  entry.count++;
  rateMap.set(key, entry);
  return { allowed: true, remaining: maxCalls - entry.count };
}

function getCached(key) {
  // Memory cache first
  const memEntry = cache.get(key);
  if (memEntry && Date.now() - memEntry.cachedAt < CACHE_TTL[key]) {
    return { result: memEntry.result, cached_at: memEntry.isoTime };
  }

  // DB fallback — survives server restarts
  const analysisType = key === 'anomalies' || key === 'anomaly' ? 'anomaly' : 'alert_triage';

  const dbEntry = db.prepare(`
    SELECT result_json, created_at
    FROM ai_analysis_history
    WHERE analysis_type = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(analysisType);

  if (!dbEntry) return null;

  const age = Date.now() - parseSqliteTs(dbEntry.created_at);

  // Use DB cache if less than CACHE_TTL.db_fallback old
  if (age < CACHE_TTL.db_fallback) {
    const result = safeJsonParse(dbEntry.result_json);
    if (result) {
      setCached(key, result, dbEntry.created_at);
      return { result, cached_at: dbEntry.created_at };
    }
  }

  return null;
}

function setCached(key, result, isoTime) {
  cache.set(key, {
    result,
    cachedAt: Date.now(),
    isoTime: isoTime || new Date().toISOString()
  });
}

function isAnthropicProvider(provider) {
  return provider === 'anthropic' || provider === 'claude';
}

function getAiStatus() {
  const provider = settingsService.get('ai_provider') || 'none';
  // settingsService stores booleans as '1'/'0'; '0'/'false' are the only disabling values.
  // null/missing reads as enabled, matching Settings.jsx default and the UI's `!== '0'` convention.
  const enabledRaw = settingsService.get('ai_enabled');
  const enabled = enabledRaw !== '0' && enabledRaw !== 'false';
  const model = settingsService.get('ai_model') || null;

  const hasKey = isAnthropicProvider(provider)
    ? !!settingsService.get('ai_anthropic_key') || !!settingsService.get('ai_claude_key')
    : provider === 'openrouter'
      ? !!settingsService.get('ai_openrouter_key')
      : false;

  let unavailable_reason = null;
  if (provider === 'none') {
    unavailable_reason = 'not_configured';
  } else if (!hasKey) {
    unavailable_reason = 'missing_key';
  } else if (!enabled) {
    unavailable_reason = 'disabled';
  }

  return {
    available: enabled && provider !== 'none' && hasKey,
    unavailable_reason,
    provider,
    model: model || (isAnthropicProvider(provider) ? 'claude-3-5-sonnet-20241022' : 'mistralai/mistral-7b-instruct'),
    enabled
  };
}

async function callAI(systemPrompt, userPrompt, maxTokens = 1024, signal) {
  const status = getAiStatus();
  if (!status.available) return null;

  if (isAnthropicProvider(status.provider)) {
    return await callClaude(systemPrompt, userPrompt, maxTokens, status.model, signal);
  }
  if (status.provider === 'openrouter') {
    return await callOpenRouter(systemPrompt, userPrompt, maxTokens, status.model, signal);
  }
  return null;
}

async function safeCallAI(systemPrompt, userPrompt, maxTokens) {
  let result = await callAI(systemPrompt, userPrompt, maxTokens);
  if (result) return result;

  // Retry once after 1.5 seconds
  await new Promise(r => setTimeout(r, 1500));
  result = await callAI(systemPrompt, userPrompt, maxTokens);
  return result;  // null if both attempts failed
}

async function callClaude(systemPrompt, userPrompt, maxTokens, model, signal) {
  const apiKey = settingsService.get('ai_anthropic_key') || settingsService.get('ai_claude_key');
  if (!apiKey) return null;

  const resolvedModel = model || 'claude-3-5-sonnet-20241022';
  try {
    // timeout caps any single attempt; maxRetries: 1 prevents the SDK's default 2-retry
    // amplification of timeout/5xx spend (the cron's running flag would also stay pinned).
    const client = new Anthropic({ apiKey, timeout: 30000, maxRetries: 1 });
    const response = await client.messages.create({
      model: resolvedModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    }, signal ? { signal } : undefined);
    return response.content[0]?.text || null;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.error('Claude API error:', err.message);
    return null;
  }
}

async function callOpenRouter(systemPrompt, userPrompt, maxTokens, model, externalSignal) {
  const apiKey = settingsService.get('ai_openrouter_key');
  if (!apiKey) return null;

  const resolvedModel = model || 'mistralai/mistral-7b-instruct';
  // Internal 15 s ceiling, OR-ed with any caller-supplied signal so an upstream
  // cancellation (e.g. enhanceAlertWithAI's 10 s budget) aborts the underlying fetch too.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://netaiq.local',
          'X-Title': 'NetAIQ Network Dashboard'
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);

    if (!response.ok) {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
      const err = await response.json().catch(() => ({}));
      console.error('OpenRouter error:', err);
      return null;
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    clearTimeout(timeout);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    if (err.name === 'AbortError') return null;
    console.error('OpenRouter error:', err.message);
    return null;
  }
}

async function testConnection(provider, apiKey, model) {
  const testPrompt = 'Reply with exactly: {"status":"ok"}';
  let result = null;

  try {
    if (isAnthropicProvider(provider)) {
      const client = new Anthropic({ apiKey, timeout: 15000, maxRetries: 1 });
      const r = await client.messages.create({
        model: model || 'claude-3-5-sonnet-20241022',
        max_tokens: 20,
        messages: [{ role: 'user', content: testPrompt }]
      });
      result = r.content[0]?.text;
    }

    if (provider === 'openrouter') {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const r = await fetch(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://netaiq.local',
            'X-Title': 'NetAIQ Network Dashboard'
          },
          body: JSON.stringify({
            model: model || 'mistralai/mistral-7b-instruct',
            max_tokens: 20,
            messages: [{ role: 'user', content: testPrompt }]
          }),
          signal: controller.signal
        }
      );
      clearTimeout(timeout);
      if (!r.ok) {
        return { success: false, error: `HTTP ${r.status}: ${r.statusText}` };
      }
      const data = await r.json();
      result = data.choices?.[0]?.message?.content;
    }

    return result?.includes('ok')
      ? { success: true }
      : { success: false, error: 'Unexpected response: ' + result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

const CLAUDE_FALLBACK = [
  { id: 'claude-3-opus-20240229', label: 'Claude 3 Opus', is_free: false, provider: 'claude' },
  { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', is_free: false, provider: 'claude' },
  { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', is_free: false, provider: 'claude' }
];

const OPENROUTER_FALLBACK = [
  { id: 'mistralai/mistral-7b-instruct', label: 'Mistral 7B', is_free: true, sub_provider: 'mistralai' },
  { id: 'meta-llama/llama-3.1-8b-instruct', label: 'Llama 3.1 8B', is_free: true, sub_provider: 'meta-llama' },
  { id: 'openai/gpt-4o', label: 'GPT-4o', is_free: false, sub_provider: 'openai' },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', is_free: false, sub_provider: 'anthropic' }
];

async function fetchModels(provider, apiKey) {
  const cacheKey = `models_${provider}`;
  const cached = modelCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < MODEL_CACHE_TTL) {
    return { models: cached.models, fallback: false };
  }

  if (isAnthropicProvider(provider)) {
    try {
      const client = new Anthropic({ apiKey, timeout: 15000, maxRetries: 1 });
      const response = await client.models.list();
      const models = response.data
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .map(m => ({
          id: m.id,
          label: m.display_name || m.id,
          is_free: false,
          provider: 'claude'
        }));
      modelCache.set(cacheKey, { models, cachedAt: Date.now() });
      return { models, fallback: false };
    } catch (err) {
      console.error('Claude models error:', err.message);
      return { models: CLAUDE_FALLBACK, fallback: true };
    }
  }

  if (provider === 'openrouter') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const r = await fetch(
        'https://openrouter.ai/api/v1/models',
        { 
          headers: { 'Authorization': `Bearer ${apiKey}` },
          signal: controller.signal
        }
      );
      clearTimeout(timeout);
      if (!r.ok) throw new Error(`OpenRouter HTTP ${r.status}`);

      const data = await r.json();
      const models = data.data
        .filter(m => (m.context_length || 0) >= 4000)
        .map(m => ({
          id: m.id,
          label: m.name || m.id,
          description: m.description,
          context: m.context_length,
          prompt_price: m.pricing?.prompt,
          completion_price: m.pricing?.completion,
          is_free: parseFloat(m.pricing?.prompt || 1) === 0 && parseFloat(m.pricing?.completion || 1) === 0,
          sub_provider: m.id.split('/')[0],
          provider: 'openrouter'
        }))
        .sort((a, b) => {
          if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
          return a.sub_provider.localeCompare(b.sub_provider);
        });

      modelCache.set(cacheKey, { models, cachedAt: Date.now() });
      return { models, fallback: false };
    } catch (err) {
      console.error('OpenRouter models error:', err.message);
      return { models: OPENROUTER_FALLBACK, fallback: true };
    }
  }

  return { models: [], fallback: true };
}

function clearModelCache(provider) {
  modelCache.delete(`models_${provider}`);
}

async function identifyDevice(deviceId) {
  const device = db.prepare(`
    SELECT d.*, s.name as segment_name
    FROM devices d
    LEFT JOIN segments s ON s.id = d.segment_id
    WHERE d.id = ?
            `).get(deviceId);

  if (!device) return null;

  // Step 1 — OUI lookup (free, instant).
  // Short-circuit for high/medium confidence AND for randomised MACs (AI cannot help).
  // Exception: a medium-confidence hit with no device_type (mainly Apple, where the
  // manufacturer is known but iPhone-vs-Mac needs hostname context) should fall
  // through to AI so it can disambiguate using the hostname.
  const ouiResult = lookupMac(device.mac_address);
  const ouiResolved = ouiResult && (
    ouiResult.confidence === 'high' ||
    (ouiResult.confidence === 'medium' && ouiResult.device_type) ||
    ouiResult.isRandomised
  );
  if (ouiResolved) {
    const provider = ouiResult.source === 'oui_ieee' ? 'oui_ieee' : 'oui_lookup';
    const result = {
      device_type_suggestion: ouiResult.device_type,
      manufacturer: ouiResult.manufacturer,
      os_guess: ouiResult.os_guess,
      owner_type: 'unknown',
      confidence: ouiResult.confidence,
      reasoning: `Identified via MAC OUI prefix (${ouiResult.source}). Manufacturer: ${ouiResult.manufacturer}.` +
        (ouiResult.note ? ` ${ouiResult.note}` : ''),
      suggested_name: device.hostname || `${ouiResult.manufacturer} Device`,
      provider,
      model: 'mac_oui'
    };
    saveIdentification(deviceId, device.mac_address, result, null, provider, 'mac_oui');
    return result;
  }

  // Step 2 — AI identification
  const rate = checkRateLimit(`identify_device_${deviceId}`, 3, 60000);
  if (!rate.allowed) {
    return { error: true, rateLimited: true, resetIn: rate.resetIn };
  }
  // Global cap across all identifications
  const globalRate = checkRateLimit('identify_device_global', 20, 60000);
  if (!globalRate.allowed) {
    return {
      error: true,
      rateLimited: true,
      resetIn: globalRate.resetIn,
      message: 'Global identification rate limit reached'
    }
  }

  const context = {
    mac: device.mac_address,
    ip: device.ip_address,
    hostname: device.hostname,
    is_wired: device.is_wired,
    segment: device.segment_name,
    oui_hint: ouiResult
  };

  const systemPrompt = `You are a network device identification expert.Analyse MAC addresses, OUI prefixes, hostnames, and network context to identify device type and manufacturer.Always return valid JSON only.No markdown, no explanation outside JSON.`;

  const userPrompt = `Identify this network device.
Device data: ${JSON.stringify(context)}

Valid device_type values(use exactly one):
        router, switch, ap, server, workstation, windows_laptop, mac, iphone_ipad, android, voip_phone, printer, other

Return this exact JSON:
        {
            "device_type_suggestion": string,
                "manufacturer": string,
                    "os_guess": string or null,
                        "owner_type": "staff" | "guest" | "infrastructure" | "unknown",
                            "confidence": "high" | "medium" | "low",
                                "reasoning": string,
                                    "suggested_name": string
        } `;

  const raw = await safeCallAI(systemPrompt, userPrompt, 400);
  if (!raw) return null;

  const parsed = safeJsonParse(raw) || {
    device_type_suggestion: 'other',
    manufacturer: 'Unknown',
    os_guess: null,
    owner_type: 'unknown',
    confidence: 'low',
    reasoning: raw?.slice(0, 300) || 'AI did not return valid JSON',
    suggested_name: device.hostname || device.ip_address
  };

  const status = getAiStatus();
  saveIdentification(deviceId, device.mac_address, parsed, raw, status.provider, status.model);
  return parsed;
}

function saveIdentification(deviceId, mac, result, raw, provider, model) {
  // Normalise once so DELETE, INSERT, and the discovered_devices UPDATE all
  // key on the same canonical (lowercase, colon-separated) form. Without this,
  // an uppercase or unseparated MAC would skip the DELETE and leave duplicate
  // identification rows behind.
  const cleanMac = mac ? normaliseMac(mac) : null;
  const transaction = db.transaction(() => {
    if (deviceId !== null) {
      db.prepare(`DELETE FROM ai_device_identifications WHERE device_id = ? `).run(deviceId);
    } else if (cleanMac) {
      db.prepare(`DELETE FROM ai_device_identifications WHERE mac_address = ? AND device_id IS NULL`).run(cleanMac);
    }

    db.prepare(`
      INSERT INTO ai_device_identifications
            (device_id, mac_address, device_type_suggestion, manufacturer, os_guess, owner_type,
                confidence, reasoning, suggested_name, raw_response, provider, model)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
            `).run(
      deviceId, cleanMac,
      result.device_type_suggestion, result.manufacturer, result.os_guess,
      result.owner_type, result.confidence, result.reasoning,
      result.suggested_name, raw, provider, model
    );

    if (cleanMac) {
      db.prepare('UPDATE discovered_devices SET ai_identified = 1 WHERE mac_address = ?').run(cleanMac);
    }
  });
  transaction();
}

async function identifyDiscoveredDevice(mac) {
  const cleanMac = normaliseMac(mac);
  if (!cleanMac) return null;

  // First check if already in devices table
  const registered = db.prepare('SELECT id FROM devices WHERE mac_address = ?').get(cleanMac);
  if (registered) {
    // Use existing flow
    return await identifyDevice(registered.id);
  }

  // Not registered — build context from discovered_devices directly
  const discovered = db.prepare(`
    SELECT dd.*, s.name as segment_name
    FROM discovered_devices dd
    LEFT JOIN segments s ON s.id = dd.segment_id
    WHERE dd.mac_address = ?
  `).get(cleanMac);

  if (!discovered) return null;

  // OUI lookup first — short-circuit for high/medium confidence AND randomised MACs.
  // Exception: a medium-confidence hit with no device_type (mainly Apple, where the
  // manufacturer is known but iPhone-vs-Mac needs hostname context) should fall
  // through to AI so it can disambiguate using the hostname.
  const ouiResult = lookupMac(cleanMac);
  const ouiResolved = ouiResult && (
    ouiResult.confidence === 'high' ||
    (ouiResult.confidence === 'medium' && ouiResult.device_type) ||
    ouiResult.isRandomised
  );
  if (ouiResolved) {
    const result = {
      device_type_suggestion: ouiResult.device_type,
      manufacturer: ouiResult.manufacturer,
      os_guess: ouiResult.os_guess,
      owner_type: 'unknown',
      confidence: ouiResult.confidence,
      reasoning: `Identified via MAC OUI prefix (${ouiResult.source}). Manufacturer: ${ouiResult.manufacturer}.` + (ouiResult.note ? ` ${ouiResult.note}` : ''),
      suggested_name: discovered.hostname || `${ouiResult.manufacturer} Device`,
      provider: ouiResult.source === 'oui_ieee' ? 'oui_ieee' : 'oui_lookup',
      model: 'mac_oui'
    };
    saveIdentification(null, cleanMac, result, null, result.provider, 'mac_oui');
    return result;
  }

  // AI identification - check per-MAC rate limit first
  const macRate = checkRateLimit(`identify_mac_${cleanMac}`, 3, 60000);
  if (!macRate.allowed) {
    return { error: true, rateLimited: true, resetIn: macRate.resetIn, message: 'Per-MAC rate limit reached' };
  }

  // Global cap across all identifications
  const globalRate = checkRateLimit('identify_device_global', 20, 60000);
  if (!globalRate.allowed) {
    return { error: true, rateLimited: true, resetIn: globalRate.resetIn, message: 'Global identification rate limit reached' };
  }

  const context = {
    mac: discovered.mac_address,
    ip: discovered.last_ip,
    hostname: discovered.hostname,
    is_wired: discovered.is_wired,
    segment: discovered.segment_name,
    vendor: discovered.vendor,
    oui_hint: ouiResult
  };

  const systemPrompt = "You are a network device identification expert. Analyse MAC addresses, OUI prefixes, hostnames, and network context to identify device type and manufacturer. Always return valid JSON only. No markdown, no explanation outside JSON.";
  const userPrompt = `Identify this network device.
Device data: ${JSON.stringify(context)}

Valid device_type values (use exactly one):
router, switch, ap, server, workstation, windows_laptop, mac, iphone_ipad, android, voip_phone, printer, other

Return this exact JSON:
{
  "device_type_suggestion": string,
  "manufacturer": string,
  "os_guess": string or null,
  "owner_type": "staff" | "guest" | "infrastructure" | "unknown",
  "confidence": "high" | "medium" | "low",
  "reasoning": string,
  "suggested_name": string
}`;

  const raw = await safeCallAI(systemPrompt, userPrompt, 400);
  if (!raw) return null;

  const parsed = safeJsonParse(raw) || {
    device_type_suggestion: 'other',
    manufacturer: discovered.vendor || 'Unknown',
    os_guess: null,
    owner_type: 'unknown',
    confidence: 'low',
    reasoning: raw?.slice(0, 300) || 'AI did not return valid JSON',
    suggested_name: discovered.hostname || discovered.last_ip
  };

  const status = getAiStatus();
  saveIdentification(null, cleanMac, parsed, raw, status.provider, status.model);
  return parsed;
}

function getUnidentifiedDevices() {
  return db.prepare(`
    SELECT d.id, d.hostname, d.ip_address, d.mac_address, d.device_type, s.name as segment_name
    FROM devices d
    LEFT JOIN segments s ON s.id = d.segment_id
    LEFT JOIN ai_device_identifications ai ON ai.device_id = d.id
    WHERE ai.id IS NULL
       OR d.device_type = 'other'
       OR d.hostname IS NULL
       OR d.hostname = ''
    ORDER BY d.created_at DESC
            `).all();
}

async function detectAnomalies(forceRefresh = false) {
  // Single-flight: if another caller is already running, return cached and skip.
  if (anomalyInFlight) {
    const cached = getCached('anomalies');
    return cached ? { ...cached.result, cached_at: cached.cached_at, in_flight: true } : null;
  }

  const rate = checkRateLimit('anomalies', 3, 5 * 60 * 1000);
  if (!rate.allowed && !forceRefresh) {
    const cached = getCached('anomalies');
    return cached ? { ...cached.result, cached_at: cached.cached_at, rate_limited: true } : null;
  }

  anomalyInFlight = true;
  try {
    return await runAnomalyDetection();
  } finally {
    anomalyInFlight = false;
  }
}

async function runAnomalyDetection() {
  const deviceStats = db.prepare(`
        SELECT
        d.id,
            d.hostname || ' (' || d.ip_address || ')' as device_label,
            d.is_critical,
            s.name as segment,
            ROUND(AVG(CASE WHEN p.timestamp > datetime('now', '-24 hours') THEN p.latency_ms END), 1) as avg_24h,
            ROUND(AVG(CASE WHEN p.timestamp > datetime('now', '-7 days') THEN p.latency_ms END), 1) as avg_7d,
            ROUND(MAX(CASE WHEN p.timestamp > datetime('now', '-24 hours') THEN p.latency_ms END), 1) as max_24h,
            SUM(CASE WHEN p.status = 'down' AND p.timestamp > datetime('now', '-24 hours') THEN 1 ELSE 0 END) as downs_24h,
            COUNT(CASE WHEN p.timestamp > datetime('now', '-24 hours') THEN 1 END) as pings_24h
    FROM devices d
    LEFT JOIN ping_history p ON p.device_id = d.id
    LEFT JOIN segments s ON s.id = d.segment_id
    GROUP BY d.id
    HAVING pings_24h > 5
            `).all();

  const recentAlerts = db.prepare(`
        SELECT
        a.id, a.alert_type, a.severity,
            substr(a.message, 1, 250) as message,
            d.hostname || ' (' || COALESCE(d.ip_address, '?') || ')' as device,
            d.is_critical,
            s.name as segment,
            a.created_at
    FROM alerts a
    LEFT JOIN devices d ON d.id = a.device_id
    LEFT JOIN segments s ON s.id = d.segment_id
    WHERE a.created_at > datetime('now', '-24 hours')
    ORDER BY a.created_at DESC
    LIMIT 40
  `).all();

  const systemPrompt = `You are a network anomaly detection expert for an SMB.Analyse latency trends and outage patterns.Identify genuine anomalies vs normal variation.Focus on patterns requiring attention.Always respond in English.Return only valid JSON.`;

  const userPrompt = `Analyse this SMB network data for the last 24 hours.

Device stats: ${JSON.stringify(deviceStats)}
Recent alerts: ${JSON.stringify(recentAlerts)}

Return this exact JSON:
        {
            "anomalies": [
                {
                    "severity": "critical" | "warning" | "info",
                    "type": "latency_spike" | "repeated_outage" | "segment_degradation" | "pattern_change",
                    "affected_devices": [{ "id": number, "label": string }],
                    "affected_segment": string or null,
                    "title": string,
                    "description": string,
                    "likely_cause": string,
                    "recommended_action": string
                }
            ],
                "network_health_score": number,
                    "health_summary": string,
                        "analysed_devices": number,
                            "analysis_period": "24h"
        } `;

  const raw = await safeCallAI(systemPrompt, userPrompt, 1200);
  if (!raw) return null;

  const result = safeJsonParse(raw);
  if (!result) return null;

  const status = getAiStatus();
  db.prepare(`
    INSERT INTO ai_analysis_history
            (analysis_type, provider, model, result_json, health_score, anomaly_count)
        VALUES(?,?,?,?,?,?)
            `).run(
    'anomaly', status.provider, status.model,
    JSON.stringify(result), result.network_health_score || null, result.anomalies?.length || 0
  );

  setCached('anomalies', result);
  return result;
}

async function summariseAlerts(forceRefresh = false) {
  if (triageInFlight) {
    const cached = getCached('alert_triage');
    return cached ? { ...cached.result, cached_at: cached.cached_at, in_flight: true } : null;
  }

  const rate = checkRateLimit('alert_triage', 5, 5 * 60 * 1000);
  if (!rate.allowed && !forceRefresh) {
    const cached = getCached('alert_triage');
    return cached ? { ...cached.result, cached_at: cached.cached_at, rate_limited: true } : null;
  }

  triageInFlight = true;
  try {
    return await runAlertSummary();
  } finally {
    triageInFlight = false;
  }
}

async function runAlertSummary() {
  const alerts = db.prepare(`
        SELECT
        a.id, a.alert_type, a.severity,
            substr(a.message, 1, 250) as message,
            d.hostname || ' (' || COALESCE(d.ip_address, '?') || ')' as device,
            d.is_critical,
            s.name as segment,
            a.created_at
    FROM alerts a
    LEFT JOIN devices d ON d.id = a.device_id
    LEFT JOIN segments s ON s.id = d.segment_id
    WHERE a.created_at > datetime('now', '-48 hours')
    ORDER BY a.created_at DESC
    LIMIT 50
  `).all();

  if (alerts.length === 0) {
    return {
      urgent_action_required: false,
      executive_summary: 'No alerts in the last 48 hours.',
      triage_groups: [],
      noise_alerts: [],
      noise_explanation: '',
      suggested_threshold_changes: [],
      cached_at: new Date().toISOString()
    };
  }

  const systemPrompt = `You are a network operations expert helping an SMB IT administrator triage alerts.Be direct and practical.Group related alerts.Identify noise.Always respond in English.Return only valid JSON.`;

  const userPrompt = `Triage these network alerts.

            Alerts: ${JSON.stringify(alerts)}
Current time: ${new Date().toISOString()}

Return this exact JSON:
        {
            "urgent_action_required": boolean,
                "executive_summary": string,
                    "triage_groups": [
                        {
                            "priority": 1 | 2 | 3,
                            "title": string,
                            "alert_ids": [number],
                            "device_count": number,
                            "pattern": string,
                            "recommended_action": string,
                            "estimated_impact": string
                        }
                    ],
                        "noise_alerts": [number],
                            "noise_explanation": string,
                                "suggested_threshold_changes": [
                                    {
                                        "device_id": number or null,
                                        "current_threshold": string,
                                        "suggested_threshold": string,
                                        "reason": string
                                    }
                                ]
        } `;

  const raw = await safeCallAI(systemPrompt, userPrompt, 1200);
  if (!raw) return null;

  const result = safeJsonParse(raw);
  if (!result) return null;

  const status = getAiStatus();
  db.prepare(`
    INSERT INTO ai_analysis_history
            (analysis_type, provider, model, result_json, alert_count, urgent)
        VALUES(?,?,?,?,?,?)
            `).run(
    'alert_triage', status.provider, status.model,
    JSON.stringify(result), alerts.length, result.urgent_action_required ? 1 : 0
  );

  setCached('alert_triage', result);
  return result;
}

// ─── AI-Enhanced Telegram Alert ──────────────────────────────────

const ALERT_SYSTEM_PROMPT = `You are a network operations assistant for an SMB network monitoring system. You receive structured data about network events and respond with concise, practical remediation steps for an IT administrator.

Rules:
- Maximum 4 action steps
- Each step must be specific and immediately actionable
- No markdown, no bullet symbols — use plain text with numbered steps only since output will be sent via Telegram HTML
- No preamble, no explanation of what happened — the alert already contains that
- Assume the administrator has physical access to the building and network equipment
- Keep total response under 150 words`;

const ALERT_USER_PROMPTS = {
  critical_device_offline: (ctx) => {
    const historyLines = [];
    if (ctx.outage_count_30d != null) historyLines.push(`Outages in last 30 days: ${ctx.outage_count_30d}`);
    if (ctx.uptime_7d_pct != null) historyLines.push(`7-day uptime: ${ctx.uptime_7d_pct}%`);
    if (ctx.avg_outage_duration_min != null) historyLines.push(`Average past outage duration: ${ctx.avg_outage_duration_min} minutes`);
    if (ctx.recent_outage_times?.length) historyLines.push(`Recent outage timestamps: ${ctx.recent_outage_times.join(', ')}`);
    if (ctx.concurrent_offline_in_segment?.length) historyLines.push(`Other devices also offline in segment: ${ctx.concurrent_offline_in_segment.join(', ')}`);
    if (ctx.pre_outage_pings?.length) historyLines.push(`Last 5 pings before outage (newest first): ${ctx.pre_outage_pings.join(' → ')}`);
    if (ctx.device_notes) historyLines.push(`Admin notes: ${ctx.device_notes}`);

    return `A critical network device has gone offline.

Device Name: ${ctx.hostname || 'Unknown'}
IP Address: ${ctx.ip_address || 'Unknown'}
MAC Address: ${ctx.mac_address || 'Unknown'}
Device Type: ${ctx.device_type || 'Unknown'}
Connection: ${ctx.is_wired == null ? 'Unknown' : ctx.is_wired ? 'Wired' : 'Wireless'}
Network Segment: ${ctx.segment_name || 'Unknown'}
Subnet: ${ctx.segment_cidr || 'Unknown'}
Last Seen: ${ctx.last_seen || 'Unknown'}
Time Offline: ${ctx.minutes_offline || 'Unknown'} minutes
${historyLines.length ? '\nHistorical context:\n' + historyLines.map(l => '- ' + l).join('\n') : ''}

What are the immediate action steps to investigate and restore this device? Factor in whether this appears isolated or correlated, and whether it is a known recurring issue.`;
  },

  critical_device_online: (ctx) => {
    const historyLines = [];
    if (ctx.outage_count_30d != null) historyLines.push(`Outages in last 30 days (including this one): ${ctx.outage_count_30d}`);
    if (ctx.uptime_7d_pct != null) historyLines.push(`7-day uptime: ${ctx.uptime_7d_pct}%`);
    if (ctx.avg_outage_duration_min != null) historyLines.push(`Average outage duration: ${ctx.avg_outage_duration_min} minutes`);
    if (ctx.device_notes) historyLines.push(`Admin notes: ${ctx.device_notes}`);

    return `A critical network device has come back online after being offline.

Device Name: ${ctx.hostname || 'Unknown'}
IP Address: ${ctx.ip_address || 'Unknown'}
Device Type: ${ctx.device_type || 'Unknown'}
Network Segment: ${ctx.segment_name || 'Unknown'}
Downtime: ${ctx.downtime || 'Unknown'}
${historyLines.length ? '\nHistorical context:\n' + historyLines.map(l => '- ' + l).join('\n') : ''}

What follow-up steps should the administrator take to confirm stability and document the incident? If this is a recurring issue, escalate your recommendations accordingly.`;
  },

  ap_offline: (ctx) => `A UniFi Access Point has gone offline.

AP Name: ${ctx.name || 'Unknown'}
MAC Address: ${ctx.mac || 'Unknown'}
Last Seen: ${ctx.last_seen || 'Unknown'}
Time Offline: ${ctx.minutes_offline || 'Unknown'} minutes

What are the immediate action steps to investigate and restore this access point?`,

  ap_online: (ctx) => `A UniFi Access Point has come back online after being offline.

AP Name: ${ctx.name || 'Unknown'}
MAC Address: ${ctx.mac || 'Unknown'}
Downtime: ${ctx.downtime || 'Unknown'}

What follow-up steps should the administrator take to confirm stability and document the incident?`,

  segment_offline: (ctx) => `A network segment scan returned 0 devices, indicating the segment may be unreachable.

Segment Name: ${ctx.segment_name || 'Unknown'}
Subnet: ${ctx.segment_cidr || 'Unknown'}
Expected Devices: ${ctx.expected_devices || 'Unknown'}
Time: ${ctx.current_time || new Date().toISOString()}

What are the immediate action steps to diagnose and restore connectivity to this network segment?`
};

/**
 * Enhance a Telegram alert with AI-generated remediation steps.
 * Has a hard 10-second timeout. Returns plain text or null.
 *
 * @param {'critical_device_offline'|'critical_device_online'|'ap_offline'|'ap_online'|'segment_offline'} eventType
 * @param {object} context - Event-specific data
 * @returns {Promise<string|null>}
 */
async function enhanceAlertWithAI(eventType, context) {
  try {
    const status = getAiStatus();
    if (!status.available) return null;

    // Check the telegram_ai_enhanced setting
    const aiEnhanced = settingsService.get('telegram_ai_enhanced');
    if (aiEnhanced !== '1') return null;

    // Global cap to bound AI cost during alert bursts (e.g. switch failure cascades 20 alerts).
    // When exceeded, base alert still ships — AI section is just skipped.
    const rate = checkRateLimit('enhance_alert_global', 10, 60000);
    if (!rate.allowed) {
      console.warn(`enhanceAlertWithAI: global rate limit reached, skipping AI for ${eventType} (resets in ${rate.resetIn}s)`);
      return null;
    }

    const promptBuilder = ALERT_USER_PROMPTS[eventType];
    if (!promptBuilder) {
      console.warn(`enhanceAlertWithAI: unknown event type '${eventType}'`);
      return null;
    }

    const userPrompt = promptBuilder(context);

    // 10-second budget that actually cancels the underlying HTTP request
    // (Promise.race only rejected the wrapper — the API call kept running and billed).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const result = await callAI(ALERT_SYSTEM_PROMPT, userPrompt, 300, controller.signal);
      return result || null;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.error('enhanceAlertWithAI error (non-blocking):', err.message);
    return null;
  }
}

module.exports = {
  getAiStatus, testConnection, fetchModels, clearModelCache,
  identifyDevice, identifyDiscoveredDevice, getUnidentifiedDevices, detectAnomalies,
  summariseAlerts, checkRateLimit, enhanceAlertWithAI, parseSqliteTs
};
