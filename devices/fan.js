const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Fan extends AlarmDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Home Assistant component type
        this.component = 'fan'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Fan Control'

        // Build required MQTT topics 
        this.stateTopic_fan = this.deviceTopic+'/fan/state'
        this.commandTopic_fan = this.deviceTopic+'/fan/command'
        this.stateTopic_preset = this.deviceTopic+'/fan/speed_state'
        this.commandTopic_preset = this.deviceTopic+'/fan/speed_command'
        this.stateTopic_percent = this.deviceTopic+'/fan/percent_speed_state'
        this.commandTopic_percent = this.deviceTopic+'/fan/percent_speed_command'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'
        this.prevFanState = undefined
        this.targetFanPercent = undefined
    }
    
    initDiscoveryData() {
        // Build the MQTT discovery message
        this.discoveryData.push({
            message: {
                name: this.device.name,
                unique_id: this.deviceId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_fan,
                command_topic: this.commandTopic_fan,
                percentage_state_topic: this.stateTopic_percent,
                percentage_command_topic: this.commandTopic_percent,
                preset_mode_state_topic: this.stateTopic_preset,
                preset_mode_command_topic: this.commandTopic_preset,
                preset_modes: [ "low", "medium", "high" ],
                speed_range_min: 0,
                speed_range_max: 100,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.initInfoDiscoveryData('commStatus')
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
        if (this.targetFanPercent && this.targetFanPercent != fanPercent) {
            this.publishMqtt(this.stateTopic_percent, this.targetFanPercent.toString(), true)
            this.targetFanPercent = undefined
        } else {
            this.publishMqtt(this.stateTopic_percent, fanPercent.toString(), true)
        }
        this.publishMqtt(this.stateTopic_fan, fanState, true)
        this.publishMqtt(this.stateTopic_preset, fanPreset, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic == this.commandTopic_fan) {
            this.setFanState(message)
        } else if (topic == this.commandTopic_percent) {
            this.setFanPercent(message)
        } else if (topic == this.commandTopic_preset) {
            this.setFanPreset(message)
        } else {
            debug('Received unknown command topic '+topic+' for fan: '+this.deviceId)
        }
    }

    // Set fan target state from received MQTT command message
    setFanState(message) {
        debug('Received set fan state '+message+' for fan Id: '+this.deviceId)
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

        if ( setFanPercent = 0 ) {
            debug('Received fan speed of 0%, turning fan off')
            if (this.device.data.on) { this.setFanState('off') }
            return
        } else if ( setFanPercent < 10) {
            debug('Received fan speed of '+setFanPercent+'% which is < 10%, overriding to 10%')
            setFanPercent = 10 
        } else if (setFanPercent > 100) {
            debug('Received fan speed of '+setFanPercent+'% which is > 100%, overriding to 100%')
            setFanPercent = 100
        }

        this.targetFanPercent = setFanPercent

        debug('Seting fan speed percentage to '+this.targetFanPercent+'% for fan: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        this.device.setInfo({ device: { v1: { level: this.targetFanPercent / 100 } } })
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
