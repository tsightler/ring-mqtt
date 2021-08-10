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
        this.initAttributeEntities()
    }

    publishData() {
        if (!this.subscribed) {
            // First publish so we need to find the temperature sensor as well
            this.findTemperatureSensor()
        }
        debug(JSON.stringify(data))
        this.publishAttributes()
    }

    async findTemperatureSensor() {
        const allDevices = await this.device.location.getDevices()
        this.temperatureSensor = allDevices.find(device => device.data.parentZid === this.deviceId && device.deviceType === 'sensor.temperature')
        if (this.temperatureSensor) {
            debug (`Found temperature sensor ${this.temperatureSensor.id} for thermostat ${this.deviceId}`)
            // First publish also subscribe to temperature sensor updates
            this.temperatureSensor.onData.subscribe(data => { 
                this.publishTemeratureData(data)
            })
        } else {
            debug (`Could not find temerature sensor for thermostat ${this.deviceId}`)
        } 
    }

    publishTemeratureData(data) {
        debug(JSON.stringify(data))
    }
}

module.exports = Thermostat