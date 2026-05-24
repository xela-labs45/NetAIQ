const db = require('../db/database');

// Boolean settings are stored as '1'/'0' by `set`, but legacy values and direct
// SQL writes may use 'true'/'false', 'yes'/'no', etc. Normalize on read.
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off', '', null, undefined]);

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

    getBool: (key, defaultValue = false) => {
        const raw = settingsService.get(key);
        if (raw === null || raw === undefined || raw === '') return defaultValue;
        const v = String(raw).toLowerCase();
        if (TRUE_VALUES.has(v)) return true;
        if (FALSE_VALUES.has(v)) return false;
        return defaultValue;
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
