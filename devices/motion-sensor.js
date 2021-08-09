const RingSocketDevice = require('./base-socket-device')

class MotionSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Motion Sensor'

        this.entities.motion = {
            component: 'binary_sensor',
            device_class: 'motion',
            legacy: true
        }

        this.initInfoEntities()
    }

    publishData() {
        const motionState = this.device.data.faulted ? 'ON' : 'OFF'
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, motionState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = MotionSensor
