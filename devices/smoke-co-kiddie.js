import RingSocketDevice from './base-socket-device.js'

export default class SmokeCoKiddie extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Kiddie Smoke & CO Alarm'

        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke'
        }
        this.entity.co = {
            component: 'binary_sensor',
            device_class: 'gas',
            name: `CO`
        }
    }

    publishState() {
        const deviceComponents = this.device.data.components
        const smokeState = deviceComponents?.alarm?.smoke && deviceComponents.alarm.smoke.alarmStatus === 'active' ? 'ON' : 'OFF'
        const coState = deviceComponents?.alarm?.co && deviceComponents.alarm.co.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.smoke.state_topic, smokeState)
        this.mqttPublish(this.entity.co.state_topic, coState)
        this.publishAttributes()
    }
}
