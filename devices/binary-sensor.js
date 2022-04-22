const RingSocketDevice = require('./base-socket-device')
const { RingDeviceType } = require('ring-client-api')
const utils = require( '../lib/utils' )

class BinarySensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
    }

    init(stateData) {
        let device_class = 'None'

        // Override icons and and topics
        switch (this.device.deviceType) {
            case RingDeviceType.ContactSensor:
                this.entityName = 'contact'
                this.deviceData.mdl = 'Contact Sensor'
                device_class = (this.device.data.subCategoryId == 2) ? 'window' : 'door'
                break;
            case RingDeviceType.MotionSensor:
                this.entityName = 'motion'
                this.deviceData.mdl = 'Motion Sensor',
                device_class = 'motion'
                break;
            case RingDeviceType.RetrofitZone:
                this.entityName = 'zone'
                this.deviceData.mdl = 'Retrofit Zone'
                device_class = 'safety'
                break;
            case RingDeviceType.TiltSensor:
                this.entityName = 'tilt'
                this.deviceData.mdl = 'Tilt Sensor'
                device_class = 'garage_door'
                break;
            case RingDeviceType.GlassbreakSensor:
                this.entityName = 'glassbreak'
                this.deviceData.mdl = 'Glassbreak Sensor'
                device_class = 'safety'
                break;
            default:
                if (this.device.name.toLowerCase().includes('motion')) {
                    this.entityName = 'motion'
                    this.deviceData.mdl = 'Motion Sensor',
                    device_class = 'motion'
                } else {
                    this.entityName = 'binary_sensor'
                    this.deviceData.mdl = 'Generic Binary Sensor'
                    device_class = 'None'
                }
        }

        this.data = {
            bypass_mode: stateData?.bypass_mode ? stateData.bypass_mode: 'Never',
            published_bypass_mode: false
        }

        this.entity[this.entityName] = {
            component: 'binary_sensor',
            device_class: device_class,
            isLegacyEntity: true  // Legacy compatibility
        }

        this.entity.bypass_mode = {
            component: 'select',
            options: [ 'Never', 'Faulted', 'Always' ]
        }

        this.updateDeviceState()
    }

    updateDeviceState() {
        const stateData = {
            bypass_mode: this.data.bypass_mode
        }
        utils.event.emit(`update_device_state`, this.deviceId, stateData)
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false
        const contactState = this.device.data.faulted ? 'ON' : 'OFF'
        this.mqttPublish(this.entity[this.entityName].state_topic, contactState)
        this.publishBypassModeState(isPublish)
        this.publishAttributes()
    }

    publishBypassModeState(isPublish) {
        if (this.data.bypass_mode.state !== this.data.published_bypass_mode || isPublish) {
            this.data.published_bypass_mode = this.data.bypass_mode.state
            this.mqttPublish(this.entity.bypass_mode.state_topic, this.data.bypass_mode.state)
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'bypass_mode/command':
                this.setBypassMode(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set Stream Select Option
    async setBypassMode(message) {
        this.debug(`Received set bypass mode to ${message}`)
        if (this.entity.bypass_mode.options.includes(message)) {
            if (this.data.stream.event.session) {
                this.data.stream.event.session.kill()
            }
            this.data.bypass_mode.state = message
            this.updateDeviceState()
        } else {
            this.debug('Received invalid value for sensor bypass mode')
        }
    }
}

module.exports = BinarySensor
