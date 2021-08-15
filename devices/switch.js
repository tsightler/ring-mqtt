const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Switch extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = (this.device.data.categoryId === 2) ? 'Light' : 'Switch'
        this.component = (this.device.data.categoryId === 2) ? 'light' : 'switch'
        
        this.entity[this.component] = {
            component: this.component,
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        this.publishMqtt(this.entity[this.component].state_topic, this.device.data.on ? "ON" : "OFF", true)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'switch/command':
            case 'light/command':
                this.setSwitchState(message)
                break;
            default:
                debug(`Received unknown command topic ${topic} for ${this.component} ${this.deviceId}`)
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchState(value) {
        debug(`Received set switch state ${value} for switch ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`)
        const command = value.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                this.device.setInfo({ device: { v1: { on: (command === 'on') ? true : false } } })
                break;
            }
            default:
                debug(`Received invalid command for switch ${this.deviceId}`)
        }
    }
}

module.exports = Switch