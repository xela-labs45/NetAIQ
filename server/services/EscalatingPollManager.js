// Move require inside the logic to avoid circular dependency with pingService
// const pingService = require('./pingService');

class EscalatingPollManager {
    constructor() {
        this.offlineDevices = new Map(); // deviceId -> { attempts, timer, device, fastify }
        this.MAX_ATTEMPTS = 20;
        this.INTERVAL_MS = 30000; // 30 seconds
    }

    startEscalation(device, fastify) {
        if (this.offlineDevices.has(device.id)) {
            return; // Already escalating
        }

        fastify.log.warn(`Starting escalating poll for critical device: ${device.hostname || device.ip_address}`);

        const timer = setInterval(async () => {
            const pollData = this.offlineDevices.get(device.id);
            if (!pollData) {
                clearInterval(timer);
                return;
            }

            pollData.attempts += 1;
            fastify.log.info(`Escalating poll for ${device.hostname || device.ip_address} (Attempt ${pollData.attempts}/${this.MAX_ATTEMPTS})`);

            try {
                // Ping the device
                // This will use performPing so we don't trigger recursively from pingDevice if we used it.
                // Wait, if it recovers during escalating poll, we want alertService to know and send "came back online".
                // We should use pingService.pingDevice(device, fastify) to handle alerts automatically.
                // But wait, pingDevice itself triggers startEscalation/stopEscalation!
                // To avoid loops, since isEscalating is checked in criticalPingJob, it's fine if pingDevice calls stopEscalation.
                const pingService = require('./pingService');
                await pingService.pingDevice(device, fastify);
            } catch (err) {
                fastify.log.error(`Escalating poll error for ${device.ip_address}: ${err.message}`);
            }

            if (pollData && pollData.attempts >= this.MAX_ATTEMPTS) {
                fastify.log.warn(`Escalating poll for ${device.hostname || device.ip_address} reached max attempts (${this.MAX_ATTEMPTS}). Falling back to normal poll.`);
                this.stopEscalation(device.id);
            }

        }, this.INTERVAL_MS);

        this.offlineDevices.set(device.id, {
            attempts: 0,
            timer,
            device,
            fastify
        });
    }

    stopEscalation(deviceId, reason = 'recovery or cap') {
        const pollData = this.offlineDevices.get(deviceId);
        if (pollData) {
            clearInterval(pollData.timer);
            this.offlineDevices.delete(deviceId);
            pollData.fastify.log.info(`Stopped escalating poll for device ID ${deviceId} (${reason}).`);
        }
    }

    isEscalating(deviceId) {
        return this.offlineDevices.has(deviceId);
    }

    getEscalatingStatus() {
        const statusList = [];
        for (const [id, data] of this.offlineDevices.entries()) {
            statusList.push({
                deviceId: id,
                name: data.device.hostname || data.device.ip_address,
                attempts: data.attempts,
                max: this.MAX_ATTEMPTS
            });
        }
        return statusList;
    }

    clearAll() {
        for (const [id, data] of this.offlineDevices.entries()) {
            clearInterval(data.timer);
            this.offlineDevices.delete(id);
        }
    }
}

// Export singleton
const escalatingPollManager = new EscalatingPollManager();
module.exports = escalatingPollManager;
