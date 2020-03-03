const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class MultiLevelSwitch extends AlarmDevice {
    async init(mqttClient) {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'light'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/switch_state'
        this.commandTopic = this.deviceTopic+'/switch_command'
        this.brightnessStateTopic = this.deviceTopic+'/brightness_state'
        this.brightnessCommandTopic = this.deviceTopic+'/brightness_command'
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
            command_topic: this.commandTopic,
            brightness_scale: 100,
            brightness_state_topic: this.brightnessStateTopic,
            brightness_command_topic: this.brightnessCommandTopic
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(mqttClient, this.configTopic, JSON.stringify(message))
        mqttClient.subscribe(this.commandTopic)
        mqttClient.subscribe(this.brightnessCommandTopic)
    }

    publishData(mqttClient) {
        const switchState = this.device.data.on ? "ON" : "OFF"
        const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0) 
        // Publish device state
        this.publishMqtt(mqttClient, this.stateTopic, switchState, true)
        this.publishMqtt(mqttClient, this.brightnessStateTopic, switchLevel.toString(), true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes(mqttClient)
    }
    
    // Process messages from MQTT command topic
    processCommand(message, cmdTopicLevel) {
        if (cmdTopicLevel == 'switch_command') {
            this.setSwitchState(message)
        } else if (cmdTopicLevel == 'brightness_command') {
            this.setSwitchLevel(message)
        } else {
            debug('Somehow received unknown command topic level '+cmdTopicLevel+' for switch Id: '+this.deviceId)
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
