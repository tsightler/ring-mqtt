const RingSocketDevice = require('./base-socket-device')

class CoAlarm extends RingSocketDevice {
    constructor(deviceInfo, parentDevice) {
        super(deviceInfo)
        this.deviceData.mdl = 'CO Alarm'
        this.deviceData.mf = (parentDevice && parentDevice.data && parentDevice.data.manufacturerName) 
            ? parentDevice.data.manufacturerName 
            : 'Ring'

        this.entity.co = {
            component: 'binary_sensor',
            device_class: 'gas',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        const coState = this.device.data.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.co.state_topic, coState, true)
        this.publishAttributes()
    }
}

module.exports = CoAlarm