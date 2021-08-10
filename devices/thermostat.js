const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Thermostat extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Thermostat'
        this.foundComponentDevices = false

        this.entities.climate = {
            component: 'climate'
        }
        this.initAttributeEntities()
    }

    async findComponentDevices() {
        this.foundComponentDevices = true
        const allDevices = await this.device.location.getDevices()

        this.temperatureSensor = allDevices.find(device => device.data.parentZid === this.deviceId && device.deviceType === 'sensor.temperature')
        if (this.temperatureSensor) {
            debug (`Found temperature sensor ${this.temperatureSensor.id} for thermostat ${this.deviceId}`)
            // First publish also subscribe to temperature sensor updates
            this.temperatureSensor.onData.subscribe(() => { 
                this.publishData()
            })
        } else {
            debug (`Could not find temerature sensor for thermostat ${this.deviceId}`)
        }

        this.operatingStatus = allDevices.find(device => device.data.parentZid === this.deviceId && device.deviceType === 'thermostat-operating-status')
        if (this.operatingStatus) {
            debug (`Found operating status sensor ${this.operatingStatus.id} for thermostat ${this.deviceId}`)
            // First publish also subscribe to temperature sensor updates
            this.operatingStatus.onData.subscribe(() => { 
                this.publishData()
            })
        } else {
            debug (`Could not find operating status sensor for thermostat ${this.deviceId}`)
        }
    }

    async publishData() {
        if (!this.foundComponentDevices) {
            // First publish so we need to find the other thermostat components as well
            await this.findComponentDevices()
        }
        debug(`fanMode: ${this.device.data.fanMode}`)
        debug(`mode: ${this.device.data.mode}`)
        debug(this.device.data.modeSetpoints)
        debug(`setPoint: ${this.device.data.setPoint}`)
        debug(`setPointMin: ${this.device.data.setPointMin}`)
        debug(`setPointMax: ${this.device.data.setPointMax}`)

        if (this.operatingStatus) {
            debug(`isCoolOn: ${this.operatingStatus.data.isCoolOn}`)
            debug(`isHeatOn: ${this.operatingStatus.data.isHeatOn}`)
            debug(`isCool2ndOn: ${this.operatingStatus.data.isCool2ndOn}`)
            debug(`isHeat2ndOn: ${this.operatingStatus.data.isHeat2ndOn}`)
            debug(`operatingMode: ${this.operatingStatus.data.operatingMode}`)
        }
        if (this.temperatureSensor) {
            debug(`Temperature: ${this.temperatureSensor.data.celsius}`)
            debug(`faultHigh: ${this.temperatureSensor.data.faultHigh}`)
            debug(`faultLow: ${this.temperatureSensor.data.faultLow}`)
            debug(`faulted: ${this.temperatureSensor.data.faulted}`)
        }
        this.publishAttributes()
    }
}

module.exports = Thermostat