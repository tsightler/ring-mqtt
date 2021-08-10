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
        this.findTemperatureSensor()
        this.initAttributeEntities()
    }

    async findTemperatureSensor() {
        const allDevices = await this.device.location.getDevices()
        this.temperatureSensor = allDevices.filter(device => device.data.parentZid === this.deviceId && device.deviceType === 'sensor.temerature')
        if (this.temperatureSensor.length > 0 ) {
            debug (`Found temperature sensor ${this.temperatureSensor.id} for thermostat ${this.deviceId}`)
        } else {
            debug (`Could not find temerature sensor for thermostat ${this.deviceId}`)
        } 
    }

    publishData() {
        if (!this.subscribed) {
            // First publish also subscribe to temperature sensor updates
            this.temperatureSensor.onData.subscribe((temperatureData) => { 
                this.publishTemeratureData(temperatureData)
            })
        }
        debug(JSON.stringify(data))
        this.publishAttributes()
    }

    publishTemeratureData(data) {
        debug(JSON.stringify(data))
    }
}

module.exports = Thermostat