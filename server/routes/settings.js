const db = require('../db/database');
const bcrypt = require('bcrypt');
const { authenticate } = require('../services/unifiService');
const { sendEmailAlert } = require('../services/alertService');

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

        // Mask passwords
        if (settings.unifi_password) settings.unifi_password = '••••••••';
        if (settings.smtp_pass) settings.smtp_pass = '••••••••';

        return settings;
    };

    fastify.get('/', async (request, reply) => {
        reply.send({ settings: getSettingsMasked() });
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

    fastify.put('/polling', async (request, reply) => {
        saveSettings(request.body);

        // Restart jobs with new intervals
        require('../jobs/pingJob')(fastify);
        require('../jobs/unifiJob')(fastify);

        reply.send({ success: true });
    });

    fastify.post('/test-unifi', async (request, reply) => {
        try {
            await authenticate();
            reply.send({ success: true, message: 'Connected successfully' });
        } catch (err) {
            reply.code(400).send({ error: true, message: err.message });
        }
    });

    fastify.post('/test-email', async (request, reply) => {
        const result = await sendEmailAlert({
            severity: 'info',
            alert_type: 'test_email',
            message: 'This is a test email sent from the NetMon settings page.'
        });

        if (result) {
            reply.send({ success: true, message: 'Test email sent successfully' });
        } else {
            reply.code(500).send({ error: true, message: 'Failed to send test email. Check settings and logs.' });
        }
    });

    fastify.put('/password', async (request, reply) => {
        const { current_password, new_password } = request.body;

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(request.user.id);
        const match = await bcrypt.compare(current_password, user.password_hash);

        if (!match) {
            return reply.code(400).send({ error: true, message: 'Incorrect current password' });
        }

        const hash = await bcrypt.hash(new_password, 12);
        db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);

        reply.send({ success: true });
    });
};
