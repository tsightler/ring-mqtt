const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Beam extends AlarmDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Setup device topics based on capabilities.
        switch (this.device.data.deviceType) {
            case 'group.light-group.beams':
                this.deviceData.mdl = 'Lighting Group'
                this.isLightGroup = true
                this.groupId = this.device.data.groupId
                this.initMotionTopics()
                this.initLightTopics()
                break;
            case 'switch.transformer.beams':
                this.deviceData.mdl = 'Lighting Transformer'
                this.initLightTopics()
                break;
            case 'switch.multilevel.beams':
                this.deviceData.mdl = 'Lighting Switch/Light'
                this.initMotionTopics()
                this.initLightTopics()
                break;
            case 'motion-sensor.beams':
                this.deviceData.mdl = 'Lighting Motion Sensor'
                this.initMotionTopics()
                break;
        }
    }
    
    initMotionTopics() {
        this.stateTopic_motion = this.deviceTopic+'/motion/state'
        this.configTopic_motion = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'/config'
    }

    initLightTopics() {
        this.stateTopic_light = this.deviceTopic+'/light/state'
        this.commandTopic_light = this.deviceTopic+'/light/command'
        this.configTopic_light = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'/config'

        this.lightDuration = this.config.beams_duration ? Math.min(this.config.beams_duration, 32767) : 0
        this.stateTopic_light_duration = this.deviceTopic+'/light/duration_state'
        this.commandTopic_light_duration = this.deviceTopic+'/light/duration_command'
        this.configTopic_light_duration = 'homeassistant/number/'+this.locationId+'/'+this.deviceId+'_duration/config'
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

            discoveryMessage = {
                message: {
                    name: this.device.name+' Duration',
                    unique_id: this.deviceId+'_duration',
                    availability_topic: this.availabilityTopic,
                    payload_available: 'online',
                    payload_not_available: 'offline',
                    state_topic: this.stateTopic_light_duration,
                    command_topic: this.commandTopic_light_duration,
                    min: 0,
                    max: 32767,
                    device: this.deviceData
                }
            }
            this.discoveryData.push({
                message: discoveryMessage,
                configTopic: this.configTopic_light_duration
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
            this.publishMqtt(this.stateTopic_light_duration, this.lightDuration.toString(), true)
        }
        if (!this.isLightGroup) {
            this.publishAttributes()
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic == this.commandTopic_light) {
            this.setLightState(message)
        } else if (topic == this.commandTopic_brightness) {
            this.setLightLevel(message)
        } else if (topic == this.commandTopic_light_duration) {
            this.setLightDuration(message)
        } else {
            debug('Received unknown command topic '+topic+' for beams light: '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setLightState(message) {
        debug('Received set state '+message+' for beams light: '+this.deviceId)
        debug('Location: '+ this.locationId)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                // TODO: Make this configurable
                const setDuration = this.lightDuration > 0 ? Math.min(this.lightDuration, 32767) : undefined
                const setState = command === 'on' ? true : false
                if (this.isLightGroup && this.groupId) {
                    this.device.location.setLightGroup(this.groupId, setState, setDuration)
                } else {
                    const data = setState ? { lightMode: 'on', setDuration } : { lightMode: 'default' }
                    this.device.sendCommand('light-mode.set', data)
                }
                break;
            }
            default:
                debug('Received invalid command for beams light')
        }
    }

    // Set switch target state on received MQTT command message
    setLightLevel(message) {
        const level = message
        debug('Received set brightness level to '+level+' for beams light: '+this.deviceId)
        debug('Location: '+ this.locationId)
        if (isNaN(level)) {
             debug('Brightness command received but not a number')
        } else if (!(level >= 0 && level <= 100)) {
            debug('Brightness command received but out of range (0-100)')
        } else {
            this.device.setInfo({ device: { v1: { level: level / 100 } } })
        }
    }

    setLightDuration(message) {
        const duration = message
        debug('Received set light duration to '+duration+' seconds for beams light: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(duration)) {
                debug('Light duration command received but value is not a number')
        } else if (!(duration >= 0 && duration <= 32767)) {
            debug('Light duration command received but out of range (0-32767)')
        } else {
            this.lightDuration = duration
            this.publishMqtt(this.stateTopic_light_duration, this.lightDuration.toString(), true)            
        }
    }
}

module.exports = Beam
