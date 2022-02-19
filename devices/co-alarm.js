const RingSocketDevice = require('./base-socket-device')
const { RingDeviceType } = require('@tsightler/ring-client-api')

class CoAlarm extends RingSocketDevice {
    constructor(deviceInfo, allDevices) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'CO Alarm'
        const parentDevice = allDevices.find(d => d.id === this.device.data.parentZid && d.deviceType === RingDeviceType.SmokeAlarm)
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
        this.publishMqtt(this.entity.co.state_topic, coState)
        this.publishAttributes()
    }
}

module.exports = CoAlarm