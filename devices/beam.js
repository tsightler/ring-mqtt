const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Beam extends AlarmDevice {
    async init() {

        this.availabilityTopic = this.alarmTopic+'/beam/'+this.deviceId+'/status'
        this.attributesTopic = this.alarmTopic+'/beam/'+this.deviceId+'/attributes'
        
        // Build required MQTT topics for device for each entity        
        if (this.device.data.deviceType === 'group.light-group.beams') {
            this.isLightGroup = true
            this.groupId = this.device.data.groupId
        }

        if (this.deviceType !== 'switch.transformer.beams') {
            this.deviceTopic_motion = this.alarmTopic+'/binary_sensor/'+this.deviceId
            this.stateTopic_motion = this.deviceTopic_motion+'/motion_state'
            this.configTopic_motion = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'/config'
        }

        if (this.deviceType !== 'motion-sensor.beams') {
            this.deviceTopic_light = this.alarmTopic+'/light/'+this.deviceId
            this.stateTopic_light = this.deviceTopic_light+'/switch_state'
            this.commandTopic_light = this.deviceTopic_light+'/switch_command'
            this.configTopic_light = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'/config'
        }

        if (this.deviceType === 'switch.multilevel.beams') {
            this.stateTopic_brightness = this.deviceTopic_light+'brightness_state'
            this.commandTopic_brightness = this.deviceTopic_light+'brightness_command'
        }

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery()
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    publishDiscovery() {
        // Build the MQTT discovery messages and publish devices

        if (this.stateTopic_motion) {
            const message = {
                name: this.device.name+' - Motion',
                unique_id: this.deviceId+'_motion',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_motion,
                json_attributes_topic: this.attributesTopic,
                device_class: 'motion'
            }
            debug('HASS config topic: '+this.configTopic_motion)
            debug(message)
            this.publishMqtt(this.configTopic_motion, JSON.stringify(message))    
        }

        if (this.stateTopic_light) {
            const message = {
                name: this.device.name+' - Light',
                unique_id: this.deviceId+'_light',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_light,
                json_attributes_topic: this.attributesTopic,
                command_topic: this.commandTopic_light
            }
            if (this.stateTopic_brightness) {
                message.brightness_scale = 100
                message.brightness_state_topic = this.stateTopic_brightness,
                message.brightness_command_topic = this.commandTopic_brightness
            }
            debug('HASS config topic: '+this.configTopic_light)
            debug(message)
            this.publishMqtt(this.configTopic_light, JSON.stringify(message))
            this.mqttClient.subscribe(this.commandTopic_light)
            if (this.commandTopic_brightness) { 
                this.mqttClient.subscribe(this.commandTopic_brightness)
            }            
        }
    }

    publishData() {
        if (this.stateTopic_motion) {
            const motionState = this.device.data.motionState === 'faulted' ? 'ON' : 'OFF'
            this.publishMqtt(this.stateTopic_motion, motionState, true)
        }
        if (this.stateTopic_light) {
            const switchState = this.device.data.on ? 'ON' : 'OFF'
            this.publishMqtt(this.stateTopic_light, switchState, true)
            if (this.stateTopic_brightness) {
                const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0)
                this.publishMqtt(this.stateTopic_brightness, switchLevel, true)
            }
        }
        if (!this.isLightGroup) {
            this.publishAttributes()
        }
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
                // TODO: Make this configurable
                const lightDuration = undefined
                let lightOn = command === 'on' ? true : false
                if (this.isLightGroup && this.groupId) {
                    this.device.location.setLightGroup(this.groupId, lightOn, lightDuration)
                } else {
                    const data = lightOn ? { lightMode: 'on', lightDuration } : { lightMode: 'default' }
                    this.device.sendCommand('light-mode.set', data)
                }
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

module.exports = Beam
