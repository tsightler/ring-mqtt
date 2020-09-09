const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Beam extends AlarmDevice {
    async publish(locationConnected) { 
        // Only initialize if location websocket is connected
        if (!locationConnected) { return }

        // Setup device topics based on capabilities.
        switch (this.device.data.deviceType) {
            case 'group.light-group.beams':
                this.deviceData.mdl = 'Lighting Group'
                this.isLightGroup = true
                this.groupId = this.device.data.groupId
                this.stateTopic_motion = this.deviceTopic+'/motion/state'
                this.configTopic_motion = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'/config'
                this.stateTopic_light = this.deviceTopic+'/light/state'
                this.commandTopic_light = this.deviceTopic+'/light/command'
                this.configTopic_light = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'/config'
                break;
            case 'switch.transformer.beams':
                this.deviceData.mdl = 'Lighting Transformer'
                this.stateTopic_light = this.deviceTopic+'/light/state'
                this.commandTopic_light = this.deviceTopic+'/light/command'
                this.configTopic_light = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'/config'
                break;
            case 'switch.multilevel.beams':
                this.deviceData.mdl = 'Lighting Switch/Light'
                this.stateTopic_motion = this.deviceTopic+'/motion/state'
                this.configTopic_motion = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'/config'
                this.stateTopic_light = this.deviceTopic+'/light/state'
                this.commandTopic_light = this.deviceTopic+'/light/command'
                this.configTopic_light = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'/config'
                break;
            case 'motion-sensor.beams':
                this.deviceData.mdl = 'Lighting Motion Sensor'
                this.stateTopic_motion = this.deviceTopic+'/motion/state'
                this.configTopic_motion = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'/config'
                break;
        }

        // Publish device data
        this.publishDevice()
    }

    initDiscoveryData() {
        // Build the MQTT discovery messages for beam components
        if (this.stateTopic_motion) {
            this.discoveryData.push({
                message: {
                    name: this.device.name+' Motion',
                    unique_id: this.deviceId+'_motion',
                    availability_topic: this.availabilityTopic,
                    payload_available: 'online',
                    payload_not_available: 'offline',
                    state_topic: this.stateTopic_motion,
                    device_class: 'motion',
                    device: this.deviceData
                },
                configTopic: this.configTopic_motion
            })
        }

        if (this.stateTopic_light) {
            let discoveryMessage = {
                name: this.device.name+' Light',
                unique_id: this.deviceId+'_light',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_light,
                command_topic: this.commandTopic_light
            }
            if (this.stateTopic_brightness) {
                discoveryMessage.brightness_scale = 100
                discoveryMessage.brightness_state_topic = this.stateTopic_brightness,
                discoveryMessage.brightness_command_topic = this.commandTopic_brightness
            }
            discoveryMessage.device = this.deviceData
            this.discoveryData.push({
                message: discoveryMessage,
                configTopic: this.configTopic_light
            })        
        }

        this.initInfoDiscoveryData()
    }

    publishData() {
        if (this.stateTopic_motion) {
            const motionState = this.device.data.motionStatus === 'faulted' ? 'ON' : 'OFF'
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
