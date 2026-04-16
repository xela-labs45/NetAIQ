
const db = require('../db/database');
const { lookupMac } = require('./macOuiService');

/**
 * Backfills vendor, device_type, and os_guess for devices that are missing them.
 * Runs once on startup.
 */
async function backfillVendors(fastify) {
    try {
        const devices = db.prepare(`
            SELECT id, mac_address 
            FROM devices 
            WHERE (vendor IS NULL OR device_type IS NULL OR os_guess IS NULL)
            AND mac_address IS NOT NULL
        `).all();

        if (devices.length === 0) return;

        let count = 0;
        const updateStmt = db.prepare(`
            UPDATE devices 
            SET vendor = COALESCE(vendor, ?),
                device_type = COALESCE(device_type, ?),
                os_guess = COALESCE(os_guess, ?)
            WHERE id = ?
        `);

        const transaction = db.transaction((deviceList) => {
            for (const device of deviceList) {
                const oui = lookupMac(device.mac_address);
                if (oui) {
                    updateStmt.run(
                        oui.manufacturer || null,
                        oui.device_type || null,
                        oui.os_guess || null,
                        device.id
                    );
                    count++;
                }
            }
        });

        transaction(devices);

        if (count > 0) {
            if (fastify) {
                fastify.log.info(`OUI Backfill: Updated ${count} devices with vendor/type/os info.`);
            } else {
                console.log(`OUI Backfill: Updated ${count} devices with vendor/type/os info.`);
            }
        }
    } catch (err) {
        if (fastify) {
            fastify.log.error(`OUI Backfill failed: ${err.message}`);
        } else {
            console.error(`OUI Backfill failed: ${err.message}`);
        }
    }
}

module.exports = { backfillVendors };
