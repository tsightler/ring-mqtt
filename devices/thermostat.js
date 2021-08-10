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
        this.getComponentDevices()
        this.initAttributeEntities()
    }

    async getComponentDevices() {
        const allDevices = await this.device.location.getDevices()
        this.componentDevices = allDevices.filter(device => device.data.parentZid === this.deviceId)
        console.log(this.componentDevices)
    }

    publishData() {
        this.publishAttributes()
    }
}

module.exports = Thermostat