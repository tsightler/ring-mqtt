const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class MultiLevelSwitch extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type
        this.component = 'light'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Dimmer Switch'

        // Build required MQTT topics
        this.stateTopic_light = this.deviceTopic+'/light/state'
        this.commandTopic_light = this.deviceTopic+'/light/command'
        this.stateTopic_brightness = this.deviceTopic+'/light/brightness_state'
        this.commandTopic_brightness = this.deviceTopic+'/light/brightness_command'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

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
                state_topic: this.stateTopic_light,
                command_topic: this.commandTopic_light,
                brightness_scale: 100,
                brightness_state_topic: this.stateTopic_brightness,
                brightness_command_topic: this.commandTopic_brightness,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.initInfoDiscoveryData('commStatus')
    }

    publishData() {
        const switchState = this.device.data.on ? "ON" : "OFF"
        const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0) 
        // Publish device state
        this.publishMqtt(this.stateTopic_light, switchState, true)
        this.publishMqtt(this.stateTopic_brightness, switchLevel.toString(), true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic == this.commandTopic_light) {
            this.setSwitchState(message)
        } else if (topic == this.commandTopic_brightness) {
            this.setSwitchLevel(message)
        } else {
            debug('Somehow received unknown command topic '+topic+' for switch Id: '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchState(message) {
        debug('Received set switch state '+message+' for switch Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                const on = (command === 'on') ? true : false
                this.device.setInfo({ device: { v1: { on } } })
                break;
            }
            default:
                debug('Received invalid command for switch!')
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchLevel(message) {
        const level = message
        debug('Received set switch level to '+level+' for switch Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
             debug('Brightness command received but not a number!')
        } else if (!(message >= 0 && message <= 100)) {
            debug('Brightness command receives but out of range (0-100)!')
        } else {
            this.device.setInfo({ device: { v1: { level: level / 100 } } })
        }
    }
}

module.exports = MultiLevelSwitch
