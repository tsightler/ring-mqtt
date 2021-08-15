const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const RingSocketDevice = require('./base-socket-device')

class Fan extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Fan Control'

        this.entity.fan = {
            component: 'fan',
            isLegacyEntity: true  // Legacy compatibility
        }

        this.data = {
            targetFanPercent: undefined
        }
    }

    publishData() {
        const fanState = this.device.data.on ? "ON" : "OFF"
        const fanPercent = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(this.device.data.level*100) : 0)
        let fanPreset = "unknown"
        if (fanPercent > 67) {
            fanPreset = 'high'
        } else if (fanPercent > 33) {
            fanPreset = 'medium'
        } else if (fanPercent >= 0) {
            fanPreset = 'low'
        } else {
            debug('ERROR - Could not determine fan preset value.  Raw percent value: '+fanPercent+'%')
        }
        
        // Publish device state
        // targetFanPercent is a small hack to work around Home Assistant UI behavior
        if (this.data.targetFanPercent && this.data.targetFanPercent !== fanPercent) {
            this.publishMqtt(this.entity.fan.percentage_state_topic, this.data.targetFanPercent.toString(), true)
            this.data.targetFanPercent = undefined
        } else {
            this.publishMqtt(this.entity.fan.percentage_state_topic, fanPercent.toString(), true)
        }
        this.publishMqtt(this.entity.fan.state_topic, fanState, true)
        this.publishMqtt(this.entity.fan.preset_mode_state_topic, fanPreset, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'fan/command':
                this.setFanState(message)
                break;
            case 'fan/percent_speed_command':
                this.setFanPercent(message)
                break;
            case 'fan/speed_command':
                this.setFanPreset(message)
                break;
            default:
                debug('Received unknown command topic '+topic+' for fan: '+this.deviceId)
        }
    }

    // Set fan target state from received MQTT command message
    setFanState(message) {
        debug('Received set fan state '+message+' for fan: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off':
                const on = (command === 'on') ? true : false
                this.device.setInfo({ device: { v1: { on } } })
                break;
            default:
                debug('Received invalid command for fan!')
        }
    }

    // Set fan speed based on percent
    async setFanPercent(message) {
        if (isNaN(message)) {
            debug('Fan speed percent command received but value is not a number')
            return
        }

        let setFanPercent = parseInt(message)

        if (setFanPercent === 0) {
            debug('Received fan speed of 0%, turning off fan: '+this.deviceId)
            if (this.device.data.on) { this.setFanState('off') }
            return
        } else if (setFanPercent < 10) {
            debug('Received fan speed of '+setFanPercent+'% which is < 10%, overriding to 10%')
            setFanPercent = 10 
        } else if (setFanPercent > 100) {
            debug('Received fan speed of '+setFanPercent+'% which is > 100%, overriding to 100%')
            setFanPercent = 100
        }

        this.data.targetFanPercent = setFanPercent

        debug('Seting fan speed percentage to '+this.data.targetFanPercent+'% for fan: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        this.device.setInfo({ device: { v1: { level: this.data.targetFanPercent / 100 } } })
        // Automatically turn on fan when level is sent.
        await utils.sleep(1)
        if (!this.device.data.on) { this.setFanState('on') }
    }

    // Set fan speed state from received MQTT command message
    async setFanPreset(message) {
        let fanPercent
        switch(message.toLowerCase()) {
            case 'low':
                fanPercent = 33
                break;
            case 'medium':
                fanPercent = 67
                break;
            case 'high':
                fanPercent = 100
                break;
            default:
                debug('Received invalid fan preset command '+message.toLowerCase()+' for fan: '+this.deviceId)
                debug('Location Id: '+ this.locationId)
        }

        if (fanPercent) {
            debug('Received set fan preset to '+message+' for fan: '+this.deviceId)
            this.setFanPercent(fanPercent)
        }
    }
}

module.exports = Fan
