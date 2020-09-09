const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Switch extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type
        this.component = (this.device.data.categoryId === 2) ? 'light' : 'switch'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = (this.device.data.categoryId === 2) ? 'Light' : 'Switch'

        // Build required MQTT topics for device
        this.stateTopic = this.deviceTopic+'/switch/state'
        this.commandTopic = this.deviceTopic+'/switch/command'
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
                state_topic: this.stateTopic,
                command_topic: this.commandTopic,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.initInfoDiscoveryData('commStatus')
    }

    publishData() {
        const switchState = this.device.data.on ? "ON" : "OFF" 
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, switchState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message) {
        this.setSwitchState(message)
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
}

module.exports = Switch
