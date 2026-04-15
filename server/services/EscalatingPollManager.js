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
            const currentPoll = this.offlineDevices.get(device.id);
            if (!currentPoll) {
                clearInterval(timer);
                return;
            }

            fastify.log.info(`Escalating poll for ${device.hostname || device.ip_address} (Attempt ${currentPoll.attempts + 1}/${this.MAX_ATTEMPTS})`);

            try {
                const pingService = require('./pingService');
                await pingService.pingDevice(device, fastify);
                
                // BUG 3 FIX: Re-check if we are still escalating after the ping returns
                // (Recovery logic in pingDevice might have already called stopEscalation)
                const stillEscalating = this.offlineDevices.get(device.id);
                if (!stillEscalating) {
                    clearInterval(timer);
                    return;
                }

                // BUG 4 FIX: Only increment attempts if the ping logic itself succeeded
                stillEscalating.attempts += 1;

                if (stillEscalating.attempts >= this.MAX_ATTEMPTS) {
                    fastify.log.warn(`Escalating poll for ${device.hostname || device.ip_address} reached max attempts (${this.MAX_ATTEMPTS}). Falling back to normal poll.`);
                    this.stopEscalation(device.id, 'max attempts reached');
                }
            } catch (err) {
                // System error (e.g. DB locked) - log it but don't count as a device attempt
                fastify.log.error(`Escalating poll system error for ${device.ip_address}: ${err.message}`);
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
