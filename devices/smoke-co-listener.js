const RingSocketDevice = require('./base-socket-device')

class SmokeCoListener extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Smoke & CO Listener'
        
        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke'
        }
        this.entity.co = {
            component: 'binary_sensor',
            device_class: 'gas',
            name: `${this.deviceData.name} CO`, // Legacy compatibility
            unique_id: `${this.deviceId}_gas`  // Legacy compatibility
        }
    }

    publishData() {
        const smokeState = this.device.data.smoke && this.device.data.smoke.alarmStatus === 'active' ? 'ON' : 'OFF'
        const coState = this.device.data.co && this.device.data.co.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.smoke.state_topic, smokeState, true)
        this.publishMqtt(this.entity.co.state_topic, coState, true)
        this.publishAttributes()
    }
}

module.exports = SmokeCoListener