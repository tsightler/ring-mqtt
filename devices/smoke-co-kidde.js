import RingSocketDevice from './base-socket-device.js'

export default class SmokeCoKidde extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')

        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke'
        }

        if (this.device.data.components?.['alarm.co']) {
            this.deviceData.mdl = 'Kidde Smoke & CO Alarm'
            this.entity.co = {
                component: 'binary_sensor',
                device_class: 'gas',
                name: `CO`
            }
        } else {
            this.deviceData.mdl = 'Kidde Smoke Alarm'
        }
    }

    publishState() {
        const components = this.device.data.components

        const smokeAlarm = components?.['alarm.smoke']
        const smokeState = smokeAlarm?.alarmStatus === 'active' ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.smoke.state_topic, smokeState)

        if (this.entity.co) {
            const coAlarm = components?.['alarm.co']
            const coState = coAlarm?.alarmStatus === 'active' ? 'ON' : 'OFF'
            this.mqttPublish(this.entity.co.state_topic, coState)
        }

        this.publishAttributes()
    }
}
