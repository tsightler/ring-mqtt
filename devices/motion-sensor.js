const RingSocketDevice = require('./base-socket-device')

class MotionSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Motion Sensor'

        this.entities.motion = {
            component: 'binary_sensor',
            device_class: 'motion',
            id: this.deviceId
        }

        this.initInfoEntities()
    }

    publishData() {
        const motionState = this.device.data.faulted ? 'ON' : 'OFF'
        this.publishMqtt(this.entities.motion.state_topic, motionState, true)
        this.publishAttributes()
    }
}

module.exports = MotionSensor