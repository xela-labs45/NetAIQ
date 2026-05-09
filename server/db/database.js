const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/netaiq.db');

// Ensure data directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(dbPath, {
    // verbose: console.log
});

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Function to initialize schema
const initDb = () => {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schema);
};

// Auto-init schema if users table doesn't exist
const tableCheck = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name='users'").get();
if (tableCheck.count === 0) {
    initDb();
} else {
    // Ensure missing tables and indexes are created on startup
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Extract and run CREATE TABLE statements
    const tableStmts = schema.match(/CREATE TABLE IF NOT EXISTS.*?;/gs);
    if (tableStmts) {
        tableStmts.forEach(stmt => db.exec(stmt));
    }

    // Extract and run CREATE INDEX statements
    const indexStmts = schema.match(/CREATE INDEX IF NOT EXISTS.*?;/gs);
    if (indexStmts) {
        indexStmts.forEach(stmt => db.exec(stmt));
    }
}

// Reset potentially stale locks on startup
db.prepare("DELETE FROM settings WHERE key = 'scan_running'").run();

// Migration: add durable login-lockout columns to users
try {
    db.prepare("ALTER TABLE users ADD COLUMN failed_attempts INTEGER DEFAULT 0").run();
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.warn('Database Migration Warning (failed_attempts column):', err.message);
    }
}
try {
    db.prepare("ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL").run();
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.warn('Database Migration Warning (locked_until column):', err.message);
    }
}

// Migration: Split ping_interval_ms into segment_scan_interval and critical_ping_interval
const legacyInterval = db.prepare("SELECT value FROM settings WHERE key = 'ping_interval_ms'").get();
if (legacyInterval) {
    const legacySeconds = Math.max(300, Math.floor(parseInt(legacyInterval.value, 10) / 1000));
    db.prepare("INSERT INTO settings (key, value) VALUES ('segment_scan_interval', ?)").run(legacySeconds.toString());
    db.prepare("INSERT INTO settings (key, value) VALUES ('critical_ping_interval', '120')").run();
    db.prepare("DELETE FROM settings WHERE key = 'ping_interval_ms'").run();
    console.log(`Migrated legacy scan interval to split polling configuration (${legacySeconds}s segment scan).`);
}

// Migration: Add vendor column to devices table if not exists
try {
    db.prepare("ALTER TABLE devices ADD COLUMN vendor TEXT DEFAULT NULL").run();
    console.log('Database Migration: Added vendor column to devices table.');
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.warn('Database Migration Warning (vendor column):', err.message);
    }
}

// Migration: Add username column to users table if not exists
// SQLite does not support ALTER TABLE ADD COLUMN with a UNIQUE constraint,
// so we add the plain column first and enforce uniqueness via a separate index.
try {
    db.prepare("ALTER TABLE users ADD COLUMN username TEXT").run();
    console.log('Database Migration: Added username column to users table.');
} catch (err) {
    if (!err.message.includes('duplicate column name')) {
        console.warn('Database Migration Warning (username column):', err.message);
    }
}
// Populate username for any user that still has NULL (covers first run after migration
// and installations where the previous UNIQUE migration silently failed).
try {
    const nullUsers = db.prepare("SELECT id, email FROM users WHERE username IS NULL").all();
    for (const u of nullUsers) {
        const derived = u.email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 31);
        db.prepare("UPDATE users SET username = ? WHERE id = ?").run(derived, u.id);
    }
    if (nullUsers.length > 0) {
        console.log(`Database Migration: Populated username for ${nullUsers.length} existing user(s).`);
    }
} catch (err) {
    console.warn('Database Migration Warning (username population):', err.message);
}
try {
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)");
} catch (err) {
    console.warn('Database Migration Warning (username unique index):', err.message);
}

module.exports = db;
