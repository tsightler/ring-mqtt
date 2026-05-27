import RingSocketDevice from './base-socket-device.js'

export default class SmokeKidde extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Kidde Smoke Alarm'

        this.entity.smoke = {
            component: 'binary_sensor',
            device_class: 'smoke'
        }
       
    }

    publishState() {
        const components = this.device.data.components
        
        const smokeAlarm = components?.['alarm.smoke']
        const smokeState = smokeAlarm?.alarmStatus === 'active' ? 'ON' : 'OFF'
        
        this.mqttPublish(this.entity.smoke.state_topic, smokeState)
        this.publishAttributes()
    }
}
