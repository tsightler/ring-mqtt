const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingSocketDevice = require('./base-socket-device')

class Thermostat extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Thermostat'

        this.entities.climate = {
            component: 'climate'
        }
        this.initComponentDevices()
        this.initAttributeEntities()
    }

    async initComponentDevices() {
        const allDevices = await this.device.location.getDevices()
        this.operatingMode = allDevices.find(device => device.data.parentZid === this.deviceId && device.deviceType === 'thermostat-operating-status')
        this.temperatureSensor = allDevices.find(device => device.data.parentZid === this.deviceId && device.deviceType === 'sensor.temperature')

        await utils.sleep(1) // Mainly just to help debug output

        if (this.operatingStatus) {
            debug (`Found operating status sensor ${this.operatingStatus.id} for thermostat ${this.deviceId}`)
            // First publish also subscribe to temperature sensor updates
            this.operatingStatus.onData.subscribe(() => { 
                if (this.subscribed) {
                    this.publishOperatingMode()
                }
            })
        } else {
            debug (`Could not find operating status sensor for thermostat ${this.deviceId}`)
        }

        if (this.temperatureSensor) {
            debug (`Found temperature sensor ${this.temperatureSensor.id} for thermostat ${this.deviceId}`)
            // First publish also subscribe to temperature sensor updates
            this.temperatureSensor.onData.subscribe(() => {
                if (this.subscribed) {
                    this.publishTemperature()
                }
            })
        } else {
            debug (`Could not find temerature sensor for thermostat ${this.deviceId}`)
        }
    }

    publishData() {
        const mode = this.device.data.mode === 'aux' ? 'heat' : this.device.data.mode
        const fanMode = this.device.data.fanMode.replace(/^./, str => str.toUpperCase())
        const auxMode = this.device.data.mode === 'aux' ? 'ON' : 'OFF'

        // If mode is off then there's really no target temperature (setPoint is tied to the mode
        // because setPoint can be different for 'cool' vs 'heat', but 'off" has no setPoint)
        // I've been unable to find a way to get the MQTT HVAC component "unset" once you set a
        // temperature value like other HA climate components, it appears the topic will only
        // process a number.  The only workaround I could think of was to just display the
        // current temperature as the set temperature when the unit is off.
        const setTemperature = this.device.data.mode === 'off'
            ? this.device.data.setPoint.toString()
            : this.temperatureSensor.data.celsius.toString()

        this.publishMqtt(this.entities.climate.mode_state_topic, mode, true)
        this.publishMqtt(this.entities.climate.fan_mode_state_topic, fanMode, true)
        this.publishMqtt(this.entities.climate.aux_state_topic, auxMode, true)
        if (setTemperature) {
            this.publishMqtt(this.entities.climate.temperature_state_topic, setTemperature, true)
        }
        this.publishOperatingMode()
        this.publishTemperature()
        this.publishAttributes()
    }

    publishOperatingMode() {
        const operatingMode = (this.operatingStatus.data.operatingMode === 'off') ? 'idle' : `${this.operatingStatus.data.operatingMode}ing`
        this.publishMqtt(this.entities.climate.action_topic, operatingMode, true)
    }

    publishTemperature() {
        const temperature = this.temperatureSensor.data.celsius.toString()
        this.publishMqtt(this.entities.climate.current_temperature_topic, temperature, true)
    }
}

module.exports = Thermostat