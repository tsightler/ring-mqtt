const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Fan extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type
        this.component = 'fan'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Fan Control'

        // Build required MQTT topics 
        this.stateTopic_fan = this.deviceTopic+'/fan/state'
        this.commandTopic_fan = this.deviceTopic+'/fan/command'
        this.stateTopic_speed = this.deviceTopic+'/fan/speed_state'
        this.commandTopic_speed = this.deviceTopic+'/fan/speed_command'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'
        this.prevFanState = undefined
        this.targetFanLevel = undefined

        // Publish device data
        this.publishDevice()
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
                speed_state_topic: this.stateTopic_speed,
                speed_command_topic: this.commandTopic_speed,
                speeds: [ "low", "medium", "high" ],
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.initInfoDiscoveryData('commStatus')
    }

    publishData() {
        const fanState = this.device.data.on ? "ON" : "OFF"
        const fanSpeed = (this.device.data.level && !isNaN(this.device.data.level) ? this.device.data.level : 0)
        let fanLevel = "unknown"
        if (0 <= fanSpeed && fanSpeed <= 0.33) {
            fanLevel = 'low'
        } else if (0.33 <= fanSpeed && fanSpeed <= 0.67) {
            fanLevel = 'medium'
        } else if (0.67 <= fanSpeed && fanSpeed <= 1) {
            fanLevel = 'high'
        } else {
            debug('ERROR - Could not determine fan speed.  Raw value: '+fanSpeed)
        }
        
        // Publish device state
        // targetFanLevel is a hack to work around Home Assistant UI behavior
        if (this.targetFanLevel && this.targetFanLevel != fanLevel) {
            this.publishMqtt(this.stateTopic_speed, this.targetFanLevel, true)
        } else {
            this.publishMqtt(this.stateTopic_speed, fanLevel, true)
        }
        this.publishMqtt(this.stateTopic_fan, fanState, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic == this.commandTopic_fan) {
            this.setFanState(message)
        } else if (topic == this.commandTopic_speed) {
            this.setFanLevel(message)
        } else {
            debug('Somehow received unknown command topic '+topic+' for fan Id: '+this.deviceId)
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

    // Set fan speed state from received MQTT command message
    async setFanLevel(message) {
        let level = undefined
        debug('Received set fan to '+message+' for fan Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        switch(message.toLowerCase()) {
            case 'low':
                level = 0.33
                break;
            case 'medium':
                level = 0.67
                break;
            case 'high':
                level = 1
                break;
            default:
                debug('Speed command received but out of range (low,medium,high)!')
        }

        if (level) {
            debug('Set fan level to: '+level*100+'%')
            this.device.setInfo({ device: { v1: { level: level } } })
            this.targetFanLevel = message.toLowerCase()

            // Automatically turn on fan when level is sent.
            // Home assistant normally does this but we want the
            // same behavior for non-HA users as well.
            await utils.sleep(1)
            const fanState = this.device.data.on ? "ON" : "OFF"
            if (fanState == 'OFF') { this.setFanState('on') }
        }
    }
}

module.exports = Fan
