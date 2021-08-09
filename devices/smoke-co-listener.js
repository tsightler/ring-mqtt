const RingSocketDevice = require('./base-socket-device')

class SmokeCoListener extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Smoke & CO Listener'

        this.entities.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke'
        }
        this.entities.co = {
            component: 'binary_sensor',
            device_class: 'gas'
        }

        this.initInfoEntities() 
    }

    publishData() {
        const smokeState = this.device.data.smoke && this.device.data.smoke.alarmStatus === 'active' ? 'ON' : 'OFF'
        const coState = this.device.data.co && this.device.data.co.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entities.smoke.state_topic, smokeState, true)
        this.publishMqtt(this.entities.co.state_topic, coState, true)
        this.publishAttributes()
    }
}

module.exports = SmokeCoListener