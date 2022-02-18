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

        this.data = {
            mode: (() => { return this.device.data.mode === 'aux' ? 'heat' : this.device.data.mode }),
            publishedMode: false,
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
            ... this.entity.thermostat.modes.includes('auto')
                ? { 
                    autoSetPointInProgress: false,
                    autoSetPoint: {
                        low: this.device.data.modeSetpoints.auto.setPoint-this.device.data.modeSetpoints.auto.deadBand,
                        high: this.device.data.modeSetpoints.auto.setPoint+this.device.data.modeSetpoints.auto.deadBand
                    },
                    deadBandMin: this.device.data.modeSetpoints.auto.deadBandMin ? this.device.data.modeSetpoints.auto.deadBandMin : 1.11111,
                    autoSetPointInProgress: false,
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

        const mode = this.data.mode()

        // Hackish workaround to clear states in HA when switching between modes with single/multi-setpoint
        // (i.e. auto to heat/cool, or heat/cool to auto). This is mostly to workaround limitations with
        // the Home Assistant MQTT Thermostat integration that does not allow clearing exiting values from
        // set points.  This in turn causes confusing/unusable behavior in Home Assistant UI, especially
        // when switch from auto modes to heat/cool mode as the UI will still show low/high settings even
        // though these modes only have a single setpoint.  This hack sends a temporary rediscovery message
        // without including auto mode, then immediately sends the proper discovery data which effectively
        // clears state with only a minor UI blip.
        if (this.entity.thermostat.modes.includes('auto') && mode !== this.data.publishedMode) {
            if (!this.data.publishedMode || mode === 'auto' || this.data.publishedMode === 'auto') {
                const supportedModes = this.entity.thermostat.modes
                this.entity.thermostat.modes = ["off", "cool", "heat"]
                await this.publishDiscovery()
                await utils.msleep(100)
                this.entity.thermostat.modes = supportedModes
                await this.publishDiscovery()
                await utils.msleep(500)
            }
            this.data.publishedMode = mode
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
            // When in auto mode publish separate low/high set point values.  The Ring API
            // does use low/high settings, but rather a single setpoint with deadBand representing
            // the offset for the low/high temp from the middle setPoint
            if (!this.data.setPointInProgress) {
                this.data.autoSetPoint.low = this.device.data.setPoint-this.device.data.deadBand
                this.data.autoSetPoint.high = this.device.data.setPoint+this.device.data.deadBand
                this.publishMqtt(this.entity.thermostat.temperature_low_state_topic, this.data.autoSetPoint.low)
                this.publishMqtt(this.entity.thermostat.temperature_high_state_topic, this.data.autoSetPoint.high)
            }
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
        const mode = this.data.mode()
        switch (componentCommand) {
            case 'thermostat/mode_command':
                this.setMode(message)
                break;
            case 'thermostat/temperature_command':
                if (mode !== 'auto') {
                    this.setSetPoint(message)
                } else if (mode === 'off') {
                    debug('Recevied set primary temperature but thermostat is off')
                } else {
                    debug('Recevied set primary temperature but thermostat is in dual setpoint (auto) mode')
                }
                break;
            case 'thermostat/temperature_low_command':
                if (mode === 'auto') {
                    this.setAutoSetPoint(message, 'low')
                } else if (mode === 'off') {
                    debug('Recevied set primary temperature but thermostat is off')
                } else {
                    debug('Received set low temperature but thermostat is not in single setpoint (cool/heat) mode')
                }
                break;
            case 'thermostat/temperature_high_command':
                if (mode === 'auto') {
                    this.setAutoSetPoint(message, 'high')
                } else if (mode === 'off') {
                    debug('Recevied set primary temperature but thermostat is off')
                } else {
                    debug('Received set low temperature but thermostat is not in single setpoint (cool/heat) mode')
                }
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
        // Home Assistant always sends both low/high temps even when only one had changed.
        // This lock prevents concurrent updates overwriting each other and instead
        // waits 50ms to give time for the second value to be updated
        if (!this.data.setPointInProgress) {
            this.data.setPointInProgress = true
            if (isNaN(value)) {
                this.debug(`New ${type} temperature set point received but is not a number!`)
            } else if (!(value >= 10 && value <= 37.22223)) {
                this.debug(`New ${type} temperature set point received but is out of range (10-37.22223°C)!`)
            } else {
                this.data.autoSetPoint[type] = Number(value)

                // Home Assistant always sends both low/high values when changing temp so wait
                // a few milliseconds for the other temperature value to be updated
                await utils.msleep(50)

                const setPoint = (this.data.autoSetPoint.low+this.data.autoSetPoint.high)/2
                const deadBand = this.data.autoSetPoint.high-setPoint

                if (deadBand >= this.data.deadBandMin) {
                    this.device.setInfo({ device: { v1: { setPoint, deadBand } } })
                    this.publishMqtt(this.entity.thermostat.temperature_low_state_topic, this.data.autoSetPoint.low)
                    this.publishMqtt(this.entity.thermostat.temperature_high_state_topic, this.data.autoSetPoint.high)
                } else {
                    this.debug(`New ${type} temperature set point would be below the allowed deadBand range ${this.data.deadBandMin}`)
                }
            }
            this.data.setPointInProgress = false
        } else {
            if (isNaN(value)) {
                this.debug(`New ${type} temperature set point received but is not a number!`)
            } else if (!(value >= 10 && value <= 37.22223)) {
                this.debug(`New ${type} temperature set point received but is out of range (10-37.22223°C)!`)
            } else {
                this.data.autoSetPoint[type] = Number(value)
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