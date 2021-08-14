const RingSocketDevice = require('./base-socket-device')

class TemperatureSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Temperature Sensor'

        this.entity.temperature = {
            component: 'sensor',
            device_class: 'temperature',
            unit_of_measurement: '°C',
            state_class: 'measurement'
        }
        this.initAttributeEntities()
    }

    publishData() {
        const temperature = this.temperatureSensor.data.celsius.toString()
        this.publishMqtt(this.entity.motion.state_topic, motionState, true)
        this.publishAttributes()
    }
}

module.exports = TemperatureSensor