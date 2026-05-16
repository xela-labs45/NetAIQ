const bcrypt = require('bcrypt');
const db = require('./database');

async function seed() {
    console.log('Seeding database...');

    // Check if admin user exists. Guard on username, which is the column
    // carrying the UNIQUE constraint we'd collide with on insert (the admin's
    // email may have been changed in-app, so an email check is unreliable).
    const checkUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');

    if (!checkUser) {
        const saltRounds = 12;
        const defaultPassword = 'Admin@1234';
        const hash = await bcrypt.hash(defaultPassword, saltRounds);

        // INSERT OR IGNORE so a pre-existing admin (any email) is a no-op
        // rather than a fatal UNIQUE-constraint error that crash-loops the
        // container before the server can start.
        const result = db.prepare(`
      INSERT OR IGNORE INTO users (username, email, password_hash, must_change_password)
      VALUES (?, ?, ?, 1)
    `).run('admin', 'admin@netaiq.local', hash);
        if (result.changes > 0) {
            console.log('Admin user created: username=admin / Admin@1234');
        } else {
            console.log('Admin user already exists.');
        }
    } else {
        console.log('Admin user already exists.');
    }

    // Insert default settings if not exist
    const checkSettings = db.prepare('SELECT count(*) as count FROM settings').get();
    if (checkSettings.count === 0) {
        const defaultSettings = [
            ['unifi_url', ''],
            ['unifi_username', ''],
            ['unifi_password', ''],
            ['unifi_site', 'default'],
            ['unifi_ssl_verify', '0'],
            ['smtp_host', ''],
            ['smtp_port', '587'],
            ['smtp_secure', '0'],
            ['smtp_user', ''],
            ['smtp_pass', ''],
            ['alert_from', 'netaiq@local'],
            ['alert_to', 'admin@local'],
            ['alert_on_offline', '1'],
            ['alert_on_critical_offline', '1'],
            ['alert_on_online', '1'],
            ['alert_on_high_latency', '0'],
            ['ping_interval_ms', '60000'],
            ['unifi_interval_ms', '300000'],
            ['alert_cooldown_ms', '900000'],
            ['telegram_alerts_enabled', '0'],
            ['telegram_commands_enabled', '0'],
            ['telegram_ai_enhanced', '0'],
            ['email_offline_grace_minutes', '0'],
            ['telegram_offline_grace_minutes', '0']
        ];

        const insertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        const transaction = db.transaction((settings) => {
            for (const setting of settings) {
                insertSetting.run(setting[0], setting[1]);
            }
        });
        transaction(defaultSettings);
        console.log('Default settings populated.');
    }

    console.log('Seed complete.');
}

seed().catch(err => {
    console.error('Seeding error:', err);
    process.exit(1);
});
