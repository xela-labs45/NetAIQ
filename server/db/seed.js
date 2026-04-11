const bcrypt = require('bcrypt');
const db = require('./database');

async function seed() {
    console.log('Seeding database...');

    // Check if admin user exists
    const checkUser = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@netmon.local');

    if (!checkUser) {
        const saltRounds = 12;
        const defaultPassword = 'Admin@1234';
        const hash = await bcrypt.hash(defaultPassword, saltRounds);

        db.prepare(`
      INSERT INTO users (email, password_hash, must_change_password)
      VALUES (?, ?, 1)
    `).run('admin@netmon.local', hash);
        console.log('Admin user created: admin@netmon.local / Admin@1234');
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
            ['alert_from', 'netmon@local'],
            ['alert_to', 'admin@local'],
            ['alert_on_offline', '1'],
            ['alert_on_critical_offline', '1'],
            ['alert_on_online', '1'],
            ['alert_on_high_latency', '0'],
            ['ping_interval_ms', '60000'],
            ['unifi_interval_ms', '300000'],
            ['alert_cooldown_ms', '900000'],
            ['telegram_alerts_enabled', '0'],
            ['telegram_ai_enhanced', '0']
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
