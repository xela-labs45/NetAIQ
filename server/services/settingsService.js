const db = require('../db/database');

const settingsService = {
    get: (key) => {
        try {
            const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
            return row ? row.value : null;
        } catch (err) {
            console.error(`Error reading setting ${key}:`, err);
            return null;
        }
    },

    set: (key, value) => {
        try {
            const stringValue = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
            db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
                .run(key, stringValue);
            return true;
        } catch (err) {
            console.error(`Error saving setting ${key}:`, err);
            return false;
        }
    },

    delete: (key) => {
        try {
            db.prepare('DELETE FROM settings WHERE key = ?').run(key);
            return true;
        } catch (err) {
            console.error(`Error deleting setting ${key}:`, err);
            return false;
        }
    }
};

module.exports = settingsService;
