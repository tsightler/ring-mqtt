const RingSocketDevice = require('./base-socket-device')

class SmokeAlarm extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Smoke Alarm'
        
        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        const smokeState = this.device.data.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.smoke.state_topic, smokeState, true)
        this.publishAttributes()
    }
}

module.exports = SmokeAlarm