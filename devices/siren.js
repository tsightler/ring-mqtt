const RingSocketDevice = require('./base-socket-device')

class Siren extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Siren'
        
        this.entity.siren = {
            component: 'binary_sensor',
            unique_id: this.deviceId
        }
    }

    publishData() {
        const sirenState = this.device.data.sirenStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.siren.state_topic, sirenState, true)
        this.publishAttributes()
    }
}

module.exports = Siren