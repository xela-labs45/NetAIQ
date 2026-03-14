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
    // Ensure missing indexes are created on startup
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    // Extract only CREATE INDEX statements and run them
    const indexStmts = schema.match(/CREATE INDEX IF NOT EXISTS.*?;/gs);
    if (indexStmts) {
        indexStmts.forEach(stmt => db.exec(stmt));
    }
}

module.exports = db;
