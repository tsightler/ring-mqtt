import RingSocketDevice from './base-socket-device.js'

export default class TemperatureSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Temperature Sensor'

        this.entity.temperature = {
            component: 'sensor',
            device_class: 'temperature',
            unit_of_measurement: '°C',
            state_class: 'measurement'
        }
    }

    publishState() {
        const temperature = this.device.data.celsius.toString()
        this.mqttPublish(this.entity.temperature.state_topic, temperature)
        this.publishAttributes()
    }
}
