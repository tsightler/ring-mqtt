import RingSocketDevice from './base-socket-device.js'
import { RingDeviceType } from 'ring-client-api'
import utils from '../lib/utils.js'

export default class Thermostat extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Thermostat'

        this.operatingStatus = this.childDevices.find(d => d.deviceType === 'thermostat-operating-status'),
        this.temperatureSensor = this.childDevices.find(d => d.deviceType === RingDeviceType.TemperatureSensor)

        this.entity.thermostat = {
            component: 'climate',
            modes: Object.keys(this.device.data.modeSetpoints).filter(mode => ["off", "cool", "heat", "auto"].includes(mode)),
            fan_modes: this.device.data.hasOwnProperty('supportedFanModes')
                ? this.device.data.supportedFanModes.map(f => f.charAt(0).toUpperCase() + f.slice(1))
                : ["Auto"]
        }

        this.data = {
            currentMode: (() => { return this.device.data.mode === 'aux' ? 'heat' : this.device.data.mode }),
            publishedMode: false,
            fanMode: (() => { return this.device.data.fanMode.replace(/^./, str => str.toUpperCase()) }),
            auxMode: (() => { return this.device.data.mode === 'aux' ? 'ON' : 'OFF' }),
            setPoint: (() => {
                return this.device.data.setPoint
                    ? this.device.data.setPoint
                    : this.temperatureSensor.data.celsius 
                }),
            operatingMode: (() => { 
                return this.operatingStatus.data.operatingMode !== 'off'
                    ? `${this.operatingStatus.data.operatingMode}ing`
                    : this.device.data.mode === 'off'
                        ? 'off'
                        : this.device.data.fanMode === 'on' ? 'fan' : 'idle' 
                }),
            temperature: (() => { return this.temperatureSensor.data.celsius }),
            ... this.entity.thermostat.modes.includes('auto')
                ? { 
                    autoSetPointInProgress: false,
                    autoSetPoint: {
                        low: this.device.data.modeSetpoints.auto.setPoint-this.device.data.modeSetpoints.auto.deadBand,
                        high: this.device.data.modeSetpoints.auto.setPoint+this.device.data.modeSetpoints.auto.deadBand
                    },
                    deadBandMin: this.device.data.modeSetpoints.auto.deadBandMin ? this.device.data.modeSetpoints.auto.deadBandMin : 1.11111
                } : {}
        }

        this.operatingStatus.onData.subscribe(() => { 
            if (this.isOnline()) { 
                this.publishOperatingMode()
                this.publishAttributes()
            }
        })

        this.temperatureSensor.onData.subscribe(() => {
            if (this.isOnline()) { 
                this.publishTemperature()
                this.publishAttributes()
            }
        })
    }

    async publishState(data) {
        const isPublish = data === undefined ? true : false

        const mode = this.data.currentMode()
        await this.clearStateOnAutoModeSwitch(mode)
        this.mqttPublish(this.entity.thermostat.mode_state_topic, mode)
        this.data.publishedMode = mode
        this.publishSetpoints(mode)
        this.mqttPublish(this.entity.thermostat.fan_mode_state_topic, this.data.fanMode())
        this.mqttPublish(this.entity.thermostat.aux_state_topic, this.data.auxMode())
        this.publishOperatingMode()

        if (isPublish) { this.publishTemperature() }
        this.publishAttributes()
    }

    async clearStateOnAutoModeSwitch(mode) {
        // Hackish workaround to clear states in HA when switching between modes with single/multi-setpoint
        // (i.e. auto to heat/cool, or heat/cool to auto). This is mostly to workaround limitations with
        // the Home Assistant MQTT Thermostat integration that does not allow clearing exiting values from
        // set points. This in turn causes confusing/borderline unusable behavior in Home Assistant UI, 
        // especially when switching from auto modes to heat/cool mode as the UI will still show low/high
        // settings even though these modes only have a single setpoint. For other thermostat integrations
        // the fix is to simply set the unsused setpoint for the current mode to a null value but I can
        // find no method to do this via the MQTT thermostat integration as it always attempt to parse a
        // number. So, inatead, this hack sends an MQTT discovery message that temporarily exclused auto
        // mode from the configuraiton for the device and then, just a few hundred milliseconds later, sens immediately sends the proper discovery data which effectively
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
        }
    }

    publishSetpoints(mode) {        
        if (mode === 'auto') {
            // When in auto mode publish separate low/high set point values.  The Ring API
            // does not use low/high settings, but rather uses a single setpoint with deadBand
            // representing the low/high temp offset from the set point
            if (!this.data.setPointInProgress) {
                // Only publish state if there are no pending setpoint commands in progress
                // since update commands take ~100ms to complete and always publish new state
                // as soon as the update is completed
                this.data.autoSetPoint.low = this.device.data.setPoint-this.device.data.deadBand
                this.data.autoSetPoint.high = this.device.data.setPoint+this.device.data.deadBand
                this.mqttPublish(this.entity.thermostat.temperature_low_state_topic, this.data.autoSetPoint.low)
                this.mqttPublish(this.entity.thermostat.temperature_high_state_topic, this.data.autoSetPoint.high)
            }
        } else {
            this.mqttPublish(this.entity.thermostat.temperature_state_topic, this.data.setPoint())
        }
    }

    publishOperatingMode() {
        this.mqttPublish(this.entity.thermostat.action_topic, this.data.operatingMode())
    }

    publishTemperature() {
        this.mqttPublish(this.entity.thermostat.current_temperature_topic, this.data.temperature())
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
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
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    async setMode(value) {
        this.debug(`Received set mode ${value}`)
        const mode = value.toLowerCase()
        switch(mode) {
            case 'off':
                this.mqttPublish(this.entity.thermostat.action_topic, mode)
            case 'cool':
            case 'heat':
            case 'auto':
            case 'aux':
                if (this.entity.thermostat.modes.map(e => e.toLocaleLowerCase()).includes(mode) || mode === 'aux') {
                    this.device.setInfo({ device: { v1: { mode } } })
                    this.mqttPublish(this.entity.thermostat.mode_state_topic, mode)
                }
                break;
            default:
                this.debug(`Received invalid set mode command`)
        }
    }
    
    async setSetPoint(value) {
        const mode = this.data.currentMode()
        switch(mode) {
            case 'off':
                this.debug('Recevied set target temperature but current thermostat mode is off')
                break;
            case 'auto':
                this.debug('Recevied set target temperature but thermostat is in dual setpoint (auto) mode')
                break;
            default:
                if (isNaN(value)) {
                    this.debug(`Received set target temperature to ${value} which is not a number`)
                } else if (!(value >= 10 && value <= 37.22223)) {
                    this.debug(`Received set target temperature to ${value} which is out of allowed range (10-37.22223°C)`)
                } else {
                    this.debug(`Received set target temperature to ${value}`)
                    this.device.setInfo({ device: { v1: { setPoint: Number(value) } } })
                    this.mqttPublish(this.entity.thermostat.temperature_state_topic, value)
                }
        }
    }

    async setAutoSetPoint(value, type) {
        const mode = this.data.currentMode()
        switch(mode) {
            case 'auto':
                // Home Assistant always sends both low/high temps even when only one had changed.
                // This lock prevents concurrent updates overwriting each other and instead
                // waits 50ms to give time for the second value to be updated
                if (isNaN(value)) {
                    this.debug(`Received set auto range ${type} temperature to ${value} which is not a number`)
                } else if (!(value >= 10 && value <= 37.22223)) {
                    this.debug(`Received set auto range ${type} temperature to ${value} which is out of allowed range (10-37.22223°C)`)
                } else {
                    this.debug(`Received set auto range ${type} temperature to ${value}`)
                    this.data.autoSetPoint[type] = Number(value)
                    // Home Assistant always sends both low/high values when changing range on dual-setpoint mode
                    // so this function will be called twice for every change.  The code below locks for 100 milliseconds
                    // to allow time for the second value to be updated before proceeding to call the set function once.  
                    if (!this.data.setPointInProgress) {
                        this.data.setPointInProgress = true
                        await utils.msleep(100)

                        const setPoint = (this.data.autoSetPoint.low+this.data.autoSetPoint.high)/2
                        let deadBand = this.data.autoSetPoint.high-setPoint

                        if (deadBand < this.data.deadBandMin) {
                            // If the difference between the two temps is less than the allowed deadband take the
                            // setPoint average and add the minimum deadband to the low and high values
                            deadBand = this.data.deadBandMin
                            this.data.autoSetPoint.low = setPoint-deadBand
                            this.data.autoSetPoint.high = setPoint+deadBand
                            this.debug(`Received auto range temerature is below the minimum allowed deadBand range of ${this.data.deadBandMin}`)
                            this.debug(`Setting auto range low temperature to ${this.data.autoSetPoint.low} and high temperature to ${this.data.autoSetPoint.high}`)
                        }

                        this.device.setInfo({ device: { v1: { setPoint, deadBand } } })
                        this.mqttPublish(this.entity.thermostat.temperature_low_state_topic, this.data.autoSetPoint.low)
                        this.mqttPublish(this.entity.thermostat.temperature_high_state_topic, this.data.autoSetPoint.high)
                        this.data.setPointInProgress = false
                    }
                }
                break;
            case 'off':
                this.debug(`Recevied set auto range ${type} temperature but current thermostat mode is off`)
                break;
            default:
                this.debug(`Received set ${type} temperature but thermostat is in single setpoint (cool/heat) mode`)
        }
    }

    async setFanMode(value) {
        this.debug(`Recevied set fan mode ${value}`)
        const fanMode = value.toLowerCase()
        if (this.entity.thermostat.fan_modes.map(e => e.toLocaleLowerCase()).includes(fanMode)) {
            this.device.setInfo({ device: { v1: { fanMode }}})
            this.mqttPublish(this.entity.thermostat.fan_mode_state_topic, fanMode.replace(/^./, str => str.toUpperCase()))
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
                this.mqttPublish(this.entity.thermostat.aux_state_topic, auxMode.toUpperCase())
                break;
            default:
                this.debug('Received invalid aux mode command')
        }
    }
}
