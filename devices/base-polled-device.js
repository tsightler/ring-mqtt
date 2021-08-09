const utils = require('../lib/utils')
const RingDevice = require('./base-ring-device')

// Base class for devices/features that communicate via HTTP polling interface (cameras/chime/modes)
class RingPolledDevice extends RingDevice {
    constructor(deviceInfo) {
        this.deviceId = deviceInfo.device.data.device_id
        this.locationId = deviceInfo.device.data.location_id
        super(deviceInfo)
        this.heartbeat = 3

        // Sevice data for Home Assistant device registry 
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: 'Ring',
            mdl: this.device.model
        }
    }

    // This simple heartbeat function decrements the heartbeat counter every 20 seconds.
    // In normal operation heartbeat is constantly reset in data publish function due to
    // 20 second polling events constantly calling this function even with no changes.
    // If the heatbeat counter reaches 0 it indicates that the polling cycle has stopped.
    // In that case this function sets the device status offline.  When polling resumes 
    // the heartbeat is again set > 0 and this function sets the device online.
    async monitorHeartbeat() {
        if (this.heartbeat > 0) {
            if (this.availabilityState !== 'online') {
                await this.online()
            }
            this.heartbeat--
        } else {
            if (this.availabilityState !== 'offline') { 
                this.offline()
            }
        } 
        await utils.sleep(20)
        this.monitorHeartbeat()
    }

    // Publish heath state every 5 minutes when online
    async schedulePublishInfo() {
        await utils.sleep(this.availabilityState === 'offline' ? 60 : 300)
        if (this.availabilityState === 'online') { this.publishInfoState() }
        this.schedulePublishInfo()
    }
}

module.exports = RingPolledDevice