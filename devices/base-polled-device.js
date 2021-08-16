const utils = require('../lib/utils')
const RingDevice = require('./base-ring-device')

// Base class for devices/features that communicate via HTTP polling interface (cameras/chime/modes)
class RingPolledDevice extends RingDevice {
    constructor(deviceInfo, primaryAttribute) {
        super(deviceInfo, deviceInfo.device.data.device_id, deviceInfo.device.data.location_id, primaryAttribute)
        this.heartbeat = 3

        // Sevice data for Home Assistant device registry 
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: 'Ring',
            mdl: this.device.model
        }

        this.device.onData.subscribe((data) => {
            // Reset heartbeat counter on every polled state
            this.heartbeat = 3
            if (this.isOnline()) { this.publishData(data) }
        })

        this.monitorHeartbeat()
    }

    // Publish device discovery, set online, and send all state data
    async publish() {
        await this.publishDiscovery()
        await this.online()
        this.publishData()
    }

    // This is a simple heartbeat function for devices which use polling.  This
    // function decrements the heartbeat counter every 20 seconds.  In normal operation
    // the heartbeat is constantly reset in the data publish function due to data
    // polling events however, if something interrupts the connection, polling stops
    // and this function will decrement until the heartbeat reaches zero.  In this case
    // this function sets the device status offline.  When polling resumes the heartbeat 
    // is set > 0 and this function will set the device back online after a short delay.
    async monitorHeartbeat() {
        if (this.heartbeat > 0) {
            if (this.availabilityState !== 'online') {
                // If device was offline wait 10 seconds and check again, if still offline
                // put device online.  Useful for initial startup or republish scenarios
                // as publish will forcelly put the device online.
                await utils.sleep(10)
                if (this.heartbeat > 0 && this.availabilityState !== 'online') {
                    await this.online()
                }
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
}

module.exports = RingPolledDevice