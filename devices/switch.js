const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Switch extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = (this.device.data.categoryId === 2) ? 'Light' : 'Switch'
        this.component = (this.device.data.categoryId === 2) ? 'light' : 'switch'
        
        this.entities[this.component] = {
            component: this.component,
            unique_id: this.deviceId
        }
        this.initAttributeEntities()
    }

    publishData() {
        const switchState = this.device.data.on ? "ON" : "OFF"
        this.publishMqtt(this.entities[this.component].state_topic, switchState, true)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        const matchTopic = topic.split("/").slice(-2).join("/")
        switch (matchTopic) {
            case 'switch/command':
            case 'light/command':
                this.setSwitchState(message)
                break;
            default:
                debug(`Received unknown command topic ${topic} for ${this.component} ${this.deviceId}`)
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchState(message) {
        debug(`Received set switch state ${message} for switch ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                const on = (command === 'on') ? true : false
                this.device.setInfo({ device: { v1: { on } } })
                break;
            }
            default:
                debug(`Received invalid command for switch ${this.deviceId}`)
        }
    }
}

module.exports = Switch