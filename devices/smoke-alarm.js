const RingSocketDevice = require('./base-socket-device')

class SmokeAlarm extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Smoke Alarm'

        this.entities.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke',
            id:this.deviceId
        }

        this.initInfoEntities()        
    }

    publishData() {
        const smokeState = this.device.data.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entities.smoke.state_topic, smokeState, true)
        this.publishAttributes()
    }
}

module.exports = SmokeAlarm