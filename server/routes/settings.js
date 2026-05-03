const db = require('../db/database');
const bcrypt = require('bcrypt');
const { authenticate } = require('../services/unifiService');
const { sendEmailAlert } = require('../services/alertService');
const telegramService = require('../services/telegramService');

module.exports = async function (fastify, opts) {
    fastify.addHook('preValidation', fastify.authenticate);

    // Helper to save multiple settings
    const saveSettings = (updates) => {
        const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        const transaction = db.transaction((items) => {
            for (const [key, value] of Object.entries(items)) {
                stmt.run(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
            }
        });
        transaction(updates);
    };

    const getSettingsMasked = () => {
        const raw = db.prepare('SELECT key, value FROM settings').all();
        const settings = raw.reduce((acc, curr) => {
            acc[curr.key] = curr.value;
            return acc;
        }, {});

        // Mask passwords and API keys
        if (settings.unifi_password) settings.unifi_password = '••••••••';
        if (settings.smtp_pass) settings.smtp_pass = '••••••••';
        if (settings.ai_claude_key) settings.ai_claude_key = `sk-ant-${'*'.repeat(8)}`;
        if (settings.ai_openrouter_key) settings.ai_openrouter_key = `sk-or-${'*'.repeat(8)}`;
        if (settings.telegram_bot_token) {
            const token = settings.telegram_bot_token;
            settings.telegram_bot_token = '••••••••' + token.slice(-4);
        }

        return settings;
    };

    fastify.get('/', async (request, reply) => {
        reply.send({ settings: getSettingsMasked() });
    });

    fastify.get('/table-counts', async (request, reply) => {
        const pingCount = db.prepare('SELECT COUNT(*) as count FROM ping_history').get().count;
        const alertCount = db.prepare('SELECT COUNT(*) as count FROM alerts').get().count;
        const oldestPing = db.prepare('SELECT MIN(timestamp) as oldest FROM ping_history').get().oldest;
        const oldestAlert = db.prepare('SELECT MIN(created_at) as oldest FROM alerts').get().oldest;
        reply.send({ ping_history: pingCount, alerts: alertCount, oldest_ping: oldestPing, oldest_alert: oldestAlert });
    });


    fastify.put('/unifi', async (request, reply) => {
        const body = { ...request.body };
        // Dont overwrite password if it's just dots
        if (body.unifi_password === '••••••••') {
            delete body.unifi_password;
        }
        saveSettings(body);
        reply.send({ success: true });
    });

    fastify.put('/email', async (request, reply) => {
        const body = { ...request.body };
        if (body.smtp_pass === '••••••••') {
            delete body.smtp_pass;
        }
        saveSettings(body);
        reply.send({ success: true });
    });

    fastify.put('/ai', async (request, reply) => {
        const body = { ...request.body };
        if (body.ai_claude_key?.startsWith('sk-ant-*')) {
            delete body.ai_claude_key;
        }
        if (body.ai_anthropic_key?.startsWith('sk-ant-*')) {
            delete body.ai_anthropic_key;
        }
        if (body.ai_openrouter_key?.startsWith('sk-or-*')) {
            delete body.ai_openrouter_key;
        }

        // Sync ai_anthropic_key → ai_claude_key for backward compatibility
        if (body.ai_anthropic_key) {
            body.ai_claude_key = body.ai_anthropic_key;
        }

        saveSettings(body);

        // Restart AI jobs with new settings
        const { restartAiJobs } = require('../jobs/aiJob');
        restartAiJobs(fastify);

        reply.send({ success: true });
    });


    fastify.put('/general', async (request, reply) => {
        const GENERAL_ALLOWED = new Set(['timezone']);
        const filtered = Object.fromEntries(
            Object.entries(request.body).filter(([k]) => GENERAL_ALLOWED.has(k))
        );
        saveSettings(filtered);
        reply.send({ success: true });
    });

    fastify.put('/polling', async (request, reply) => {
        saveSettings(request.body);

        // Restart jobs with new intervals
        require('../jobs/criticalPingJob').start(fastify);
        require('../jobs/scanJob').start(fastify);
        require('../jobs/unifiJob')(fastify);

        reply.send({ success: true });
    });

    fastify.get('/polling-status', async (request, reply) => {
        const escalatingPollManager = require('../services/EscalatingPollManager');
        const criticalPingJob = require('../jobs/criticalPingJob');
        const scanJob = require('../jobs/scanJob');

        reply.send({
            criticalPoll: criticalPingJob.getStatus(),
            segmentScan: scanJob.getStatus(),
            escalatingPolls: escalatingPollManager.getEscalatingStatus()
        });
    });

    fastify.post('/test-unifi', async (request, reply) => {
        try {
            const body = request.body || {};
            const dbRows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'unifi_%'").all();
            const db_s = dbRows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});

            const testSettings = {
                unifi_url: body.unifi_url || db_s.unifi_url || null,
                unifi_username: body.unifi_username || db_s.unifi_username || null,
                unifi_password: (body.unifi_password && !body.unifi_password.startsWith('••••••••'))
                    ? body.unifi_password : (db_s.unifi_password || null),
                unifi_site: body.unifi_site || db_s.unifi_site || 'default',
                unifi_ssl_verify: body.unifi_ssl_verify !== undefined ? body.unifi_ssl_verify : db_s.unifi_ssl_verify,
            };

            if (!testSettings.unifi_url) return reply.code(400).send({ error: true, message: 'Controller URL is required' });
            if (!testSettings.unifi_username) return reply.code(400).send({ error: true, message: 'Username is required' });
            if (!testSettings.unifi_password) return reply.code(400).send({ error: true, message: 'Password is required' });

            const ok = await authenticate(testSettings);
            if (!ok) return reply.code(400).send({ error: true, message: 'Authentication failed — check your credentials' });

            reply.send({ success: true, message: 'Connected successfully' });
        } catch (err) {
            reply.code(400).send({ error: true, message: err.message });
        }
    });

    fastify.post('/test-email', async (request, reply) => {
        const body = request.body || {};
        const dbRows = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'smtp_%' OR key IN ('alert_from','alert_to')").all();
        const db_s = dbRows.reduce((a, r) => { a[r.key] = r.value; return a; }, {});

        const smtpOverride = {
            smtp_host: body.smtp_host || db_s.smtp_host,
            smtp_port: body.smtp_port || db_s.smtp_port || '587',
            smtp_secure: body.smtp_secure !== undefined ? (body.smtp_secure ? '1' : '0') : db_s.smtp_secure,
            smtp_user: body.smtp_user || db_s.smtp_user,
            smtp_pass: (body.smtp_pass && body.smtp_pass !== '••••••••')
                ? body.smtp_pass : db_s.smtp_pass,
            alert_from: body.alert_from || db_s.alert_from,
            alert_to: body.alert_to || db_s.alert_to,
        };

        const result = await sendEmailAlert({
            severity: 'info',
            alert_type: 'test_email',
            message: 'This is a test email sent from the NetAIQ settings page.'
        }, smtpOverride);

        if (result) {
            reply.send({ success: true, message: 'Test email sent successfully' });
        } else {
            reply.code(500).send({ error: true, message: 'Failed to send test email. Check settings and logs.' });
        }
    });

    // ─── Telegram Endpoints ─────────────────────────────────────

    fastify.get('/telegram', async (request, reply) => {
        const tgSettings = telegramService.getSettings();
        // Mask token — show only last 4 characters
        if (tgSettings.telegram_bot_token) {
            const token = tgSettings.telegram_bot_token;
            tgSettings.telegram_bot_token = '••••••••' + token.slice(-4);
        }
        reply.send({ settings: tgSettings });
    });

    fastify.put('/telegram', async (request, reply) => {
        const body = { ...request.body };
        // Don't overwrite token if it's the masked value
        if (body.telegram_bot_token && body.telegram_bot_token.startsWith('••••••••')) {
            delete body.telegram_bot_token;
        }
        saveSettings(body);
        reply.send({ success: true });
    });

    fastify.post('/telegram/test', async (request, reply) => {
        try {
            const body = request.body || {};
            const dbSettings = telegramService.getSettings();

            const token = (body.telegram_bot_token && !body.telegram_bot_token.startsWith('••••••••'))
                ? body.telegram_bot_token
                : dbSettings.telegram_bot_token;
            const chatId = body.telegram_chat_id || dbSettings.telegram_chat_id;

            if (!token || !chatId) {
                return reply.code(400).send({ error: true, message: 'Bot token and chat ID are required to send a test message' });
            }

            const result = await telegramService.sendTestMessageDirect(token, chatId);
            if (result.ok) {
                reply.send({ success: true, message: 'Test notification sent successfully!' });
            } else {
                reply.code(400).send({ error: true, message: result.description || 'Failed to send test message' });
            }
        } catch (err) {
            reply.code(500).send({ error: true, message: err.message || 'Unexpected error sending test message' });
        }
    });

    fastify.put('/password', async (request, reply) => {
        const { current_password, new_password, new_username } = request.body;

        if (!new_password || new_password.length < 12) {
            return reply.code(400).send({ error: true, message: 'New password must be at least 12 characters.' });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);

        // Require username setup on first login
        if (user.must_change_password === 1) {
            if (!new_username || !new_username.trim()) {
                return reply.code(400).send({ error: true, message: 'A username is required during initial account setup.' });
            }
        }

        if (new_username !== undefined) {
            const trimmed = new_username.trim();
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,30}$/.test(trimmed)) {
                return reply.code(400).send({ error: true, message: 'Username must be 3–31 characters and may only contain letters, numbers, underscores, and hyphens.' });
            }
            const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(trimmed, user.id);
            if (taken) {
                return reply.code(400).send({ error: true, message: 'That username is already taken.' });
            }
        }

        const match = await bcrypt.compare(current_password, user.password_hash);
        if (!match) {
            return reply.code(400).send({ error: true, message: 'Incorrect current password' });
        }

        const hash = await bcrypt.hash(new_password, 12);

        if (new_username !== undefined) {
            db.prepare('UPDATE users SET password_hash = ?, username = ?, must_change_password = 0 WHERE id = ?')
                .run(hash, new_username.trim(), user.id);
        } else {
            db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
        }

        reply.send({ success: true });
    });
};
