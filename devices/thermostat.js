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
        this.publishMqtt(this.entities.climate.mode_state_topic, (this.device.data.mode === 'aux') ? 'heat' : this.device.data.mode, true)
        this.publishMqtt(this.entities.climate.temperature_state_topic, this.device.data.setPoint.toString(), true)
        this.publishMqtt(this.entities.climate.fan_mode_state_topic, this.device.data.fanMode, true)
        if (this.operatingStatus) {
            this.publishMqtt(this.entities.climate.action_topic, (this.operatingStatus.data.operatingMode === 'off') ? 'off' : `${this.operatingStatus.data.operatingMode}ing`, true)
        }
        if (this.temperatureSensor) {
            this.publishMqtt(this.entities.climate.current_temperature_topic, this.temperatureSensor.data.celsius.toString(), true)
        }
        this.publishAttributes()
    }
}

module.exports = Thermostat