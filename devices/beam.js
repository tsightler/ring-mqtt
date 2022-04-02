const RingSocketDevice = require('./base-socket-device')

class Beam extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'lighting')

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

        if (utils.config.hasOwnProperty('beam_duration') && utils.config.beam_duration > 0) {
            this.entity.beam_duration.state = utils.config.beam_duration
        } else {
            this.entity.beam_duration.state = this.device.data.hasOwnProperty('onDuration') ? this.device.data.onDuration : 0
        }
    }

    publishState() {
        if (this.entity.hasOwnProperty('motion') && this.entity.motion.hasOwnProperty('state_topic')) {
            const motionState = this.device.data.motionStatus === 'faulted' ? 'ON' : 'OFF'
            this.mqttPublish(this.entity.motion.state_topic, motionState)
        }
        if (this.entity.hasOwnProperty('light') && this.entity.light.hasOwnProperty('state_topic')) {
            const switchState = this.device.data.on ? 'ON' : 'OFF'
            this.mqttPublish(this.entity.light.state_topic, switchState)
            if (this.entity.light.hasOwnProperty('brightness_state_topic')) {
                const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0)
                this.mqttPublish(this.entity.light.brightness_state_topic, switchLevel.toString())
            }
            this.mqttPublish(this.entity.beam_duration.state_topic, this.entity.beam_duration.state.toString())
        }
        if (!this.isLightGroup) {
            this.publishAttributes()
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        switch (command) {
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
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set switch target state on received MQTT command message
    setLightState(message) {
        this.debug(`Received set light state ${message}`)
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
                this.debug('Received invalid light state command')
        }
    }

    // Set switch target state on received MQTT command message
    setLightLevel(message) {
        const level = message
        this.debug(`Received set brightness level to ${level}`)
        if (isNaN(level)) {
             this.debug('Brightness command received but not a number')
        } else if (!(level >= 0 && level <= 100)) {
            this.debug('Brightness command received but out of range (0-100)')
        } else {
            this.device.setInfo({ device: { v1: { level: level / 100 } } })
        }
    }

    setLightDuration(message) {
        const duration = message
        this.debug(`Received set light duration to ${duration} seconds`)
        if (isNaN(duration)) {
            this.debug('Light duration command received but value is not a number')
        } else if (!(duration >= 0 && duration <= 32767)) {
            this.debug('Light duration command received but out of range (0-32767)')
        } else {
            this.entity.beam_duration.state = parseInt(duration)
            this.mqttPublish(this.entity.beam_duration.state_topic, this.entity.beam_duration.state.toString())            
        }
    }
}

module.exports = Beam