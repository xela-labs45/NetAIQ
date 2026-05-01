const db = require('../db/database');

/**
 * Normalizes input date to a valid JavaScript Date object.
 * Handles ISO strings, Unix seconds, and millisecond timestamps.
 * @param {Date|number|string} input 
 * @returns {Date|null}
 */
function normalizeDate(input) {
    if (!input) return null;
    if (input instanceof Date) return isNaN(input.getTime()) ? null : input;

    let d;
    if (typeof input === 'number') {
        // UniFi often sends timestamps in seconds. If the number is small enough, treat as seconds.
        // 1e11 is approx year 5138 if seconds, or 1973 if milliseconds.
        // Since we care about recent dates, anything < 3e11 is safely treated as seconds.
        // Or simply, if input < 1e11 (which covers up to early 5000s in seconds)
        if (input < 1e11) {
            d = new Date(input * 1000);
        } else {
            d = new Date(input);
        }
    } else {
        d = new Date(input);
    }
    
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Formats a date into DD-MM-YYYY HH:MM:SS format using the user-defined timezone.
 * Falls back to the system's local timezone if not specified.
 * @param {Date|number|string} date - The date to format
 * @returns {string} - Formatted date string
 */
function formatInUserTimezone(date) {
    const d = normalizeDate(date);
    if (!d) return 'Invalid Date';

    // Fetch timezone from database, fallback to system local timezone
    let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get();
        if (row && row.value) {
            timezone = row.value;
        }
    } catch (err) {
        console.error('Error fetching timezone setting:', err);
    }

    try {
        // Use Intl.DateTimeFormat for robust, standard formatting
        const formatter = new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });

        const parts = formatter.formatToParts(d);
        const p = {};
        for (const part of parts) {
             p[part.type] = part.value;
        }
        
        return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
    } catch (e) {
        console.error('Timezone formatting error:', e);
        // Fallback if invalid timezone
        return d.toISOString();
    }
}

/**
 * Converts a JS Date to SQLite CURRENT_TIMESTAMP format ('YYYY-MM-DD HH:MM:SS' UTC).
 * Use this for all cutoff/comparison values bound to SQLite queries — toISOString()
 * produces 'YYYY-MM-DDTHH:MM:SS.mssZ' which compares incorrectly against stored
 * 'YYYY-MM-DD HH:MM:SS' values because SQLite does lexicographic string comparison
 * and 'T' (0x54) sorts after ' ' (0x20), causing same-day rows to be mis-compared.
 */
function toSqliteTimestamp(date) {
    return date.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Returns err.message in development; a generic string in production.
 * Prevents internal DB schema details, file paths, and service URLs from leaking in API responses.
 */
function safeError(err) {
    if (process.env.NODE_ENV !== 'production') return err.message;
    return 'Internal server error';
}

module.exports = {
    formatInUserTimezone,
    normalizeDate,
    toSqliteTimestamp,
    safeError
};
