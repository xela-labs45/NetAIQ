const db = require('../db/database');

/**
 * Formats a date into DD-MM-YYYY HH:MM:SS format using the user-defined timezone.
 * @param {Date|number|string} date - The date to format
 * @returns {string} - Formatted date string
 */
function formatInUserTimezone(date) {
    if (!date) return 'N/A';
    
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid Date';

    // Fetch timezone from database
    let timezone = 'UTC';
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'timezone'").get();
        if (row && row.value) {
            timezone = row.value;
        }
    } catch (err) {
        console.error('Error fetching timezone setting:', err);
    }

    return d.toLocaleString('en-GB', { 
        timeZone: timezone, 
        hour12: false 
    }).replace(/\//g, '-').replace(',', '');
}

module.exports = {
    formatInUserTimezone
};
