import RingSocketDevice from './base-socket-device.js'

export default class SmokeKidde extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Kidde Smoke Alarm'

        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke'
        }

        this.entity.battery = {
            component: 'binary_sensor',
            category: 'diagnostic',
            device_class: 'battery'
        }
    }

    publishState() {
        const components = this.device.data.components

        const smokeAlarm = components?.['alarm.smoke']
        const smokeState = smokeAlarm?.alarmStatus === 'active' ? 'ON' : 'OFF'
        const batteryState = this.device.data.batteryStatus === 'low' ? 'ON' : 'OFF'

        this.mqttPublish(this.entity.smoke.state_topic, smokeState)
        this.mqttPublish(this.entity.battery.state_topic, batteryState)
        this.publishAttributes()
    }
}
