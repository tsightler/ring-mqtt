const RingSocketDevice = require('./base-socket-device')

class SmokeAlarm extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Smoke Alarm'

        // Combination Smoke/CO alarm is handled as separate devices (same as Ring app)
        // Delete childDevices key here to prevent duplicate discovery entries in log
        if (this.hasOwnProperty('childDevices')) {
            delete this.childDevices
        }
        
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