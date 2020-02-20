const debug = require('debug')('ring-mqtt')
const colors = require( 'colors/safe' )
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Switch extends AlarmDevice {
    async init(mqttClient) {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = (this.device.data.categoryId === 2) ? 'light' : 'switch'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/switch_state'
        this.commandTopic = this.deviceTopic+'/switch_command'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery(mqttClient)
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice(mqttClient)
    }

    publishDiscovery(mqttClient) {
        // Build the MQTT discovery message
        const message = {
            name: this.device.name,
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            json_attributes_topic: this.attributesTopic,
            command_topic: this.commandTopic
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(mqttClient, this.configTopic, JSON.stringify(message))
        mqttClient.subscribe(this.commandTopic)
    }

    publishData(mqttClient) {
        const switchState = this.device.data.on ? "ON" : "OFF" 
        // Publish device sensor state
        this.publishMqtt(mqttClient, this.stateTopic, switchState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes(mqttClient)
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
            case 'off':
                const on = (command === 'on') ? true : false
                this.device.setInfo({ device: { v1: { on } } })
                break;
            default:
                debug('Received invalid command for switch!')
        }
    }
}

module.exports = Switch
