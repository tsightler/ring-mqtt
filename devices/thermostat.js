const RingSocketDevice = require('./base-socket-device')
const { RingDeviceType } = require('ring-client-api')
const utils = require( '../lib/utils' )

class Thermostat extends RingSocketDevice {
    constructor(deviceInfo, allDevices) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Thermostat'

        this.childDevices = {
            operatingStatus: allDevices.find(d => d.data.parentZid === this.device.id && d.deviceType === 'thermostat-operating-status'),
            temperatureSensor: allDevices.find(d => d.data.parentZid === this.device.id && d.deviceType === RingDeviceType.TemperatureSensor)
        }

        this.entity.thermostat = {
            component: 'climate',
            modes: Object.keys(this.device.data.modeSetpoints).filter(mode => ["off", "cool", "heat", "auto"].includes(mode)),
            fan_modes: this.device.data.hasOwnProperty('supportedFanModes')
                ? this.device.data.supportedFanModes.map(f => f.charAt(0).toUpperCase() + f.slice(1))
                : ["Auto"]
        }

        this.hasAutoMode = this.entity.thermostat.modes.includes('auto') ? true : false

        this.data = {
            mode: (() => { return this.device.data.mode === 'aux' ? 'heat' : this.device.data.mode }),
            priorMode: this.device.data.mode === 'aux' ? 'heat' : this.device.data.mode,
            fanMode: (() => { return this.device.data.fanMode.replace(/^./, str => str.toUpperCase()) }),
            auxMode: (() => { return this.device.data.mode === 'aux' ? 'ON' : 'OFF' }),
            setPoint: (() => {
                return this.device.data.setPoint
                    ? this.device.data.setPoint
                    : this.childDevices.temperatureSensor.data.celsius 
                }),
            operatingMode: (() => { 
                return this.childDevices.operatingStatus.data.operatingMode !== 'off'
                    ? `${this.childDevices.operatingStatus.data.operatingMode}ing`
                    : this.device.data.mode === 'off'
                        ? 'off'
                        : this.device.data.fanMode === 'on' ? 'fan' : 'idle' 
                }),
            temperature: (() => { return this.childDevices.temperatureSensor.data.celsius }),
            ... this.hasAutoMode
                ? { 
                    setPointInProgress: false,
                    autoDeadBandMin: this.device.data.modeSetpoints.auto.deadBandMin ? this.device.data.modeSetpoints.auto.deadBandMin : 1.11111,
                    autoLowSetpoint: this.device.data.modeSetpoints.auto.setPoint-this.device.data.modeSetpoints.auto.deadBand,
                    autoHighSetpoint: this.device.data.modeSetpoints.auto.setPoint+this.device.data.modeSetpoints.auto.deadBand,
                    targetLowSetpoint: this.device.data.modeSetpoints.auto.setPoint-this.device.data.modeSetpoints.auto.deadBand,
                    targetHighSetpoint: this.device.data.modeSetpoints.auto.setPoint+this.device.data.modeSetpoints.auto.deadBand
                } : {}
        }

        this.childDevices.operatingStatus.onData.subscribe(() => { 
            if (this.isOnline()) { 
                this.publishOperatingMode()
                this.publishAttributes()
            }
        })

        this.childDevices.temperatureSensor.onData.subscribe(() => {
            if (this.isOnline()) { 
                this.publishTemperature()
                this.publishAttributes()
            }
        })
    }

    async publishData(data) {
        const isPublish = data === undefined ? true : false

        // If auto mode is every used, then always publish multiple setPoints
        const mode = this.data.mode()
        if (mode !== this.data.priorMode) {
            if (mode === 'auto' || this.data.priorMode === 'auto') {
                // const supportedModes = this.entity.thermostat.modes
                // this.entity.thermostat.modes = ["off", "cool", "heat"]
                await this.publishDiscovery()
                // this.entity.thermostat.modes = supportedModes
                // await this.publishDiscovery()
            }
            this.data.priorMode = mode
        }
        this.publishMqtt(this.entity.thermostat.mode_state_topic, mode)

        this.publishSetpoints(mode)
        this.publishMqtt(this.entity.thermostat.fan_mode_state_topic, this.data.fanMode())
        this.publishMqtt(this.entity.thermostat.aux_state_topic, this.data.auxMode())
        this.publishOperatingMode()

        if (isPublish) { this.publishTemperature() }
        this.publishAttributes()
    }

    publishSetpoints(mode) {
        if (mode === 'auto') {
            // When in auto mode publish separate low/high set point values
            const deadBand = this.device.data.modeSetpoints.auto.deadBand ? this.device.data.modeSetpoints.auto.deadBand : 1.5
            this.data.autoLowSetpoint = this.device.data.modeSetpoints.auto.setPoint-deadBand
            this.data.autoHighSetpoint = this.device.data.modeSetpoints.auto.setPoint+deadBand
            this.publishMqtt(this.entity.thermostat.temperature_low_state_topic, this.data.autoLowSetpoint)
            this.publishMqtt(this.entity.thermostat.temperature_high_state_topic, this.data.autoHighSetpoint)
        } else {
            this.publishMqtt(this.entity.thermostat.temperature_state_topic, this.data.setPoint())
        }
    }

    publishOperatingMode() {
        this.publishMqtt(this.entity.thermostat.action_topic, this.data.operatingMode())
    }

    publishTemperature() {
        this.publishMqtt(this.entity.thermostat.current_temperature_topic, this.data.temperature())
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'thermostat/mode_command':
                this.setMode(message)
                break;
            case 'thermostat/temperature_command':
                this.setSetPoint(message)
                break;
            case 'thermostat/temperature_low_command':
                this.setAutoSetPoint(message, 'low')
                break;
            case 'thermostat/temperature_high_command':
                this.setAutoSetPoint(message, 'high')
                break;
                case 'thermostat/fan_mode_command':
                this.setFanMode(message)
                break;
            case 'thermostat/aux_command':
                this.setAuxMode(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${componentCommand}`)
        }
    }

    async setMode(value) {
        this.debug(`Received set mode ${value}`)
        const mode = value.toLowerCase()
        switch(mode) {
            case 'off':
                this.publishMqtt(this.entity.thermostat.action_topic, mode)
            case 'cool':
            case 'heat':
            case 'auto':
            case 'aux':
                if (this.entity.thermostat.modes.map(e => e.toLocaleLowerCase()).includes(mode) || mode === 'aux') {
                    this.device.setInfo({ device: { v1: { mode } } })
                    this.publishMqtt(this.entity.thermostat.mode_state_topic, mode)
                }
                break;
            default:
                this.debug(`Received invalid set mode command`)
        }
    }
    
    async setSetPoint(value) {
        this.debug(`Received set target temperature to ${value}`)
        if (isNaN(value)) {
            this.debug('New temperature set point received but is not a number!')
        } else if (!(value >= 10 && value <= 37.22223)) {
            this.debug('New temperature set point received but is out of range (10-37.22223°C)!')
        } else {
            this.device.setInfo({ device: { v1: { setPoint: Number(value) } } })
            this.publishMqtt(this.entity.thermostat.temperature_state_topic, value)
        }
    }

    async setAutoSetPoint(value, type) {
        this.debug(`Received set target ${type} temperature to ${value}`)
        if (!this.data.setPointInProgress) {
            this.data.setPointInProgress = true
            if (isNaN(value)) {
                this.debug(`New ${type} temperature set point received but is not a number!`)
            } else if (!(value >= 10 && value <= 37.22223)) {
                this.debug(`New ${type} temperature set point received but is out of range (10-37.22223°C)!`)
            } else {
                if (type === 'low') {
                    this.data.targetLowSetpoint = Number(value)
                } else {
                    this.data.targetHighSetpoint = Number(value)
                }
                await utils.msleep(50)
                const setPoint = (this.data.targetHighSetpoint+this.data.targetLowSetpoint)/2
                const deadBand = this.data.targetHighSetpoint-setPoint

                if (deadBand >= this.data.autoDeadBandMin) {
                    this.device.setInfo({ device: { v1: { setPoint, deadBand } } })
                    this.publishMqtt(this.entity.thermostat.temperature_high_state_topic, this.data.targetHighSetpoint)
                    this.publishMqtt(this.entity.thermostat.temperature_low_state_topic, this.data.targetLowSetpoint)
                } else {
                    this.debug(`New ${type} temperature set point would be below the allowed deadBand range ${this.device.data.modeSetpoints.auto.deadBandMin}`)
                }
            }
            this.data.setPointInProgress = false
        } else {
            if (isNaN(value)) {
                this.debug(`New ${type} temperature set point received but is not a number!`)
            } else if (!(value >= 10 && value <= 37.22223)) {
                this.debug(`New ${type} temperature set point received but is out of range (10-37.22223°C)!`)
            } else {
                if (type === 'low') {
                    this.data.targetLowSetpoint = Number(value)
                } else {
                    this.data.targetHighSetpoint = Number(value)
                }
            }
        }
    }

    async setFanMode(value) {
        this.debug(`Recevied set fan mode ${value}`)
        const fanMode = value.toLowerCase()
        if (this.entity.thermostat.fan_modes.map(e => e.toLocaleLowerCase()).includes(fanMode)) {
            this.device.setInfo({ device: { v1: { fanMode }}})
            this.publishMqtt(this.entity.thermostat.fan_mode_state_topic, fanMode.replace(/^./, str => str.toUpperCase()))
        } else {
            this.debug('Received invalid fan mode command')
        }
    }

    async setAuxMode(value) {
        this.debug(`Received set aux mode ${value}`)
        const auxMode = value.toLowerCase()
        switch(auxMode) {
            case 'on':
            case 'off':
                const mode = auxMode === 'on' ? 'aux' : 'heat'
                this.device.setInfo({ device: { v1: { mode } } })
                this.publishMqtt(this.entity.thermostat.aux_state_topic, auxMode.toUpperCase())
                break;
            default:
                this.debug('Received invalid aux mode command')
        }
    }
}

module.exports = Thermostat