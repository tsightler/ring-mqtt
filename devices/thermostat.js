const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Thermostat extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Thermostat'

        /* this.entities.motion = {
            component: 'binary_sensor',
            device_class: 'motion',
            unique_id: this.deviceId
        } */
        debug(this.device)
        debug(deviceInfo.childDevices)
        this.initAttributeEntities()
    }

    publishData() {
        const motionState = this.device.data.faulted ? 'ON' : 'OFF'
        this.publishMqtt(this.entities.motion.state_topic, motionState, true)
        this.publishAttributes()
    }
}

module.exports = Thermostat