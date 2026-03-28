const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/netmon.db');

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

module.exports = db;
