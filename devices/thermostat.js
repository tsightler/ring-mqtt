const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingSocketDevice = require('./base-socket-device')

class Thermostat extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Thermostat'

        const fanModes = this.device.data.hasOwnProperty('supportedFanModes')
            ? this.device.data.supportedFanModes.map(f => f.charAt(0).toUpperCase() + f.slice(1))
            : ["Auto"]

        this.entities.climate = {
            component: 'climate',
            name: this.deviceData.name,
            fan_modes: fanModes
        }
        this.initComponentDevices()
        this.initAttributeEntities()
    }

    async initComponentDevices() {
        const allDevices = await this.device.location.getDevices()
        this.operatingStatus = allDevices.find(device => device.data.parentZid === this.deviceId && device.deviceType === 'thermostat-operating-status')
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
            debug (`WARNING - Could not find operating status sensor for thermostat ${this.deviceId}`)
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
            debug (`WARNING - Could not find temerature sensor for thermostat ${this.deviceId}`)
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
        const targetTemperature = this.device.data.setPoint
            ? this.device.data.setPoint.toString()
            : this.temperatureSensor.data.celsius.toString()

        this.publishMqtt(this.entities.climate.mode_state_topic, mode, true)
        this.publishMqtt(this.entities.climate.temperature_state_topic, targetTemperature, true)
        this.publishMqtt(this.entities.climate.fan_mode_state_topic, fanMode, true)
        this.publishMqtt(this.entities.climate.aux_state_topic, auxMode, true)
        this.publishOperatingMode()
        this.publishTemperature()
        this.publishAttributes()
    }

    publishOperatingMode() {
        if (this.operatingStatus) {
            const operatingMode = this.operatingStatus.data.operatingMode !== 'off'
                ? `${this.operatingStatus.data.operatingMode}ing`
                : this.device.data.mode === 'off'
                    ? 'off'
                    : this.device.data.fanMode === 'on' ? 'fan' : 'idle'
            this.publishMqtt(this.entities.climate.action_topic, operatingMode, true)
        }
    }

    publishTemperature() {
        if (this.temperatureSensor) {
            const temperature = this.temperatureSensor.data.celsius.toString()
            this.publishMqtt(this.entities.climate.current_temperature_topic, temperature, true)
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        const matchTopic = topic.split("/").slice(-2).join("/")
        switch (matchTopic) {
            case 'climate/mode_command':
                this.setMode(message)
                break;
            case 'climate/temperature_command':
                this.setTargetTemperature(message)
                break;
            case 'climate/fan_mode_command':
                this.setFanMode(message)
                break;
            case 'climate/aux_command':
                this.setAuxMode(message)
                break;
            default:
                debug(`Received unknown command topic ${topic} for ${this.component} ${this.deviceId}`)
        }
    }

    setMode(message) {
        debug(`Received set mode ${message} for thermostat ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`)
        const mode = message.toLowerCase()
        switch(command) {
            case 'off':
            case 'cool':
            case 'heat':
            case 'aux':
                this.device.setInfo({ device: { v1: { mode } } })
                this.publishMqtt(this.entities.climate.mode_state_topic, mode, true)
                break;
            default:
                debug(`Received invalid command for thermostat ${this.deviceId}`)
        }

    }
    
    setTargetTemperature(message) {
        debug(`Received set target temperature to ${message} for thermostat ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`)
        if (isNaN(message)) {
            debug('New target temperature received but not a number!')
        } else if (!(message >= 10 && message <= 37.22223)) {
            debug('New target command received but out of range (10-37.22223°C)!')
        } else {
            const setPoint = Number(message)
            this.device.setInfo({ device: { v1: { setPoint } } })
            this.publishMqtt(this.entities.climate.temperature_state_topic, setPoint, true)
        }
    }

    setFanMode(message) {
        debug(`Recevied set fan mode ${message} for thermostat ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`)
        const fanMode = message.toLowerCase()

        if (this.entities.climate.fan_modes.map(e => e.toLocaleLowerCase()).includes(fanMode)) {
            this.device.setInfo({ device: { v1: { fanMode }}})
            this.publishMqtt(this.entities.climate.fan_mode_state_topic, fanMode.replace(/^./, str => str.toUpperCase()), true)
        } else {
                debug('Received invalid fan mode command for thermostat!')
        }
    }

    setAuxMode(message) {
        debug(`Received set aux mode ${message} for thermostat ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`)
        const mode = message.toLowerCase()
        switch(mode) {
            case 'on':
            case 'off': {
                this.device.setInfo({ device: { v1: { mode } } })
                this.publishMqtt(this.entities.climate.mode_state_topic, mode, true)
                break;
            }
            default:
                debug('Received invalid aux mode command for thermostat!')
        }
    }
}

module.exports = Thermostat