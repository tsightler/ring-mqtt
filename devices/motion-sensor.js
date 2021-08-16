const RingSocketDevice = require('./base-socket-device')

class MotionSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Motion Sensor'

        this.entity.motion = {
            component: 'binary_sensor',
            device_class: 'motion',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        const sensorState = this.device.data.faulted ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.motion.state_topic, sensorState, true)
        this.publishAttributes()
    }
}

module.exports = MotionSensor