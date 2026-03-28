const db = require('../db/database');
const nodemailer = require('nodemailer');

function getSettings() {
    const settings = db.prepare('SELECT key, value FROM settings').all();
    return settings.reduce((acc, curr) => {
        acc[curr.key] = curr.value;
        return acc;
    }, {});
}

async function sendEmailAlert(alert) {
    const settings = getSettings();
    const { smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, alert_from, alert_to } = settings;

    if (!smtp_host || !alert_to) {
        console.warn('SMTP or alert recipient not configured in settings. Skipping email alert.');
        return false; // Email not configured
    }

    const transporter = nodemailer.createTransport({
        host: smtp_host,
        port: parseInt(smtp_port, 10),
        secure: smtp_secure === '1', // true for 465, false for other ports
        auth: smtp_user ? {
            user: smtp_user,
            pass: smtp_pass
        } : undefined
    });

    try {
        await transporter.sendMail({
            from: alert_from || 'netmon@localhost',
            to: alert_to,
            subject: `[NetMon] ${alert.severity.toUpperCase()} Alert: ${alert.alert_type}`,
            text: `Alert Details:
Type: ${alert.alert_type}
Severity: ${alert.severity}
Message: ${alert.message}
Time: ${new Date().toISOString()}
`
        });
        return true;
    } catch (err) {
        console.error('Failed to send email alert:', err);
        return false;
    }
}

async function createAlert({ device_id, alert_type, message, severity, fastify }) {
    // Alert deduplication: skip if identical alert exists within cooldown window
    const settings = getSettings();

    // Prefer alert_cooldown_minutes (new), fall back to alert_cooldown_ms (legacy)
    let cooldownMs;
    if (settings.alert_cooldown_minutes) {
        cooldownMs = parseInt(settings.alert_cooldown_minutes, 10) * 60 * 1000;
    } else {
        cooldownMs = parseInt(settings.alert_cooldown_ms || '900000', 10);
    }

    const recentAlert = db.prepare(`
    SELECT id, created_at FROM alerts 
    WHERE device_id = ? AND alert_type = ? 
    ORDER BY created_at DESC LIMIT 1
  `).get(device_id, alert_type);

    if (recentAlert) {
        const alertTime = new Date(recentAlert.created_at).getTime();
        if (Date.now() - alertTime < cooldownMs) {
            console.log(`Alert deduplicated (cooldown ${Math.round(cooldownMs / 60000)}min): ${alert_type} for device ${device_id}`);
            return;
        }
    }


    // Insert alert
    const stmt = db.prepare(`
    INSERT INTO alerts (device_id, alert_type, message, severity)
    VALUES (?, ?, ?, ?)
  `);
    const info = stmt.run(device_id, alert_type, message, severity);

    const alertObj = {
        id: info.lastInsertRowid,
        device_id,
        alert_type,
        message,
        severity,
        is_read: 0,
        email_sent: 0,
        created_at: new Date().toISOString()
    };

    // Check email preferences
    let shouldSendEmail = false;
    if (alert_type === 'device_down' && settings.alert_on_offline === '1') shouldSendEmail = true;
    if (alert_type === 'device_down' && severity === 'critical' && settings.alert_on_critical_offline === '1') shouldSendEmail = true;
    if (alert_type === 'device_up' && settings.alert_on_online === '1') shouldSendEmail = true;
    if (alert_type === 'high_latency' && settings.alert_on_high_latency === '1') shouldSendEmail = true;

    if (shouldSendEmail) {
        const sent = await sendEmailAlert(alertObj);
        if (sent) {
            db.prepare('UPDATE alerts SET email_sent = 1 WHERE id = ?').run(alertObj.id);
            alertObj.email_sent = 1;
        }
    }

    // Emit event
    if (fastify && fastify.io) {
        fastify.io.emit('alert:new', { alert: alertObj });

        fastify.io.emit('alert:count', getUnreadCount());
    }

    return alertObj;
}

function getUnreadCount() {
    const result = db.prepare(`
        SELECT 
            COUNT(*) as unread_count,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical_count,
            SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) as warning_count
        FROM alerts 
        WHERE is_read = 0
    `).get();

    return {
        unread_count: result.unread_count || 0,
        critical_count: result.critical_count || 0,
        warning_count: result.warning_count || 0
    };
}

function markAsRead(alert_id) {
    db.prepare('UPDATE alerts SET is_read = 1 WHERE id = ?').run(alert_id);
}

module.exports = {
    createAlert,
    sendEmailAlert,
    getUnreadCount,
    markAsRead
};
