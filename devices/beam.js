const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Beam extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Setup device topics based on capabilities.
        switch (this.device.data.deviceType) {
            case 'group.light-group.beams':
                this.deviceData.mdl = 'Lighting Group'
                this.isLightGroup = true
                this.groupId = this.device.data.groupId
                this.initMotionEntity()
                this.initLightEntity()
                break;
            case 'switch.transformer.beams':
                this.deviceData.mdl = 'Lighting Transformer'
                this.initLightEntity()
                break;
            case 'switch.multilevel.beams':
                this.deviceData.mdl = 'Lighting Switch/Light'
                this.initMotionEntity()
                this.initLightEntity()
                break;
            case 'motion-sensor.beams':
                this.deviceData.mdl = 'Lighting Motion Sensor'
                this.initMotionEntity()
                break;
        }
    }
    
    initMotionEntity() {
        this.entity.motion = {
            component: 'binary_sensor',
            device_class: 'motion'
        }
    }

    initLightEntity() {
        this.entity.light = {
            component: 'light',
            ...this.device.data.deviceType === 'switch.multilevel.beams' ? { brightness_scale: 100 } : {}
        }

        this.entity.beam_duration = {
            name: this.device.name+' Duration',
            unique_id: this.deviceId+'_duration',
            component: 'number',
            min: 0,
            max: 32767,
            icon: 'hass:timer'
        }

        if (this.config.hasOwnProperty('beam_duration') && this.config.beam_duration > 0) {
            this.entity.beam_duration.state = this.config.beam_duration
        } else {
            this.entity.beam_duration.state = this.device.data.hasOwnProperty('onDuration') ? this.device.data.onDuration : 0
        }
    }

    publishData() {
        if (this.entity.hasOwnProperty('motion') && this.entity.motion.hasOwnProperty('state_topic')) {
            const motionState = this.device.data.motionStatus === 'faulted' ? 'ON' : 'OFF'
            this.publishMqtt(this.entity.motion.state_topic, motionState, true)
        }
        if (this.entity.hasOwnProperty('light') && this.entity.light.hasOwnProperty('state_topic')) {
            const switchState = this.device.data.on ? 'ON' : 'OFF'
            this.publishMqtt(this.entity.light.state_topic, switchState, true)
            if (this.entity.light.hasOwnProperty('brightness_state_topic')) {
                const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0)
                this.publishMqtt(this.entity.light.brightness_state_topic, switchLevel.toString(), true)
            }
            this.publishMqtt(this.entity.beam_duration.state_topic, this.entity.beam_duration.state.toString(), true)
        }
        if (!this.isLightGroup) {
            this.publishAttributes()
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        const entityKey = componentCommand.split('/')[0]
        switch (componentCommand) {
            case 'light/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setLightState(message)
                }
                break;
            case 'light/brightness_command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setLightLevel(message)
                }
                break;
            case 'beam_duration/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setLightDuration(message)
                }
                break;
            default:
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
                const duration = this.entity.beam_duration.state ? Math.min(this.entity.beam_duration.state, 32767) : undefined
                const on = command === 'on' ? true : false
                if (this.isLightGroup && this.groupId) {
                    this.device.location.setLightGroup(this.groupId, on, duration)
                } else {
                    const data = on ? { lightMode: 'on', duration } : { lightMode: 'default' }
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
            this.entity.beam_duration.state = parseInt(duration)
            this.publishMqtt(this.entity.beam_duration.state_topic, this.entity.beam_duration.state.toString(), true)            
        }
    }
}

module.exports = Beam