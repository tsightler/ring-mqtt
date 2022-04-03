const RingSocketDevice = require('./base-socket-device')

class CoAlarm extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
    }

    init() {
        this.deviceData.mdl = 'CO Alarm'
        this.deviceData.mf = (this.hasOwnProperty('parentDevice') && this.parentDevice.hasOwnProperty('data') && this.parentDevice.data.hasOwnProperty('manufacturerName'))
            ? this.parentDevice.data.manufacturerName
            : 'Ring'

        this.entity.co = {
            component: 'binary_sensor',
            device_class: 'gas',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishState() {
        const coState = this.device.data.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.co.state_topic, coState)
        this.publishAttributes()
    }
}

module.exports = CoAlarm