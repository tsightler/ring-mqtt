const RingSocketDevice = require('./base-socket-device')

class SmokeAlarm extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')

        // Combination Smoke/CO alarm is handled as separate devices (same behavior as Ring app)
        // If child device exist, delete it to prevent duplicate display of device during discovery
        if (this.hasOwnProperty('childDevices')) {
            delete this.childDevices
        }
    }

    init() {
        this.deviceData.mdl = 'Smoke Alarm'
        
        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishState() {
        const smokeState = this.device.data.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.smoke.state_topic, smokeState)
        this.publishAttributes()
    }
}

module.exports = SmokeAlarm