const RingSocketDevice = require('./base-socket-device')

class Switch extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = (this.device.data.categoryId === 2) ? 'Light' : 'Switch'
        this.component = (this.device.data.categoryId === 2) ? 'light' : 'switch'
        
        this.entity[this.component] = {
            component: this.component,
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        this.mqttPublish(this.entity[this.component].state_topic, this.device.data.on ? "ON" : "OFF")
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
                this.debug(`Received message to unknown command topic: ${componentCommand}`)
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchState(message) {
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off':
                this.debug(`Received set switch state ${message}`)
                this.device.setInfo({ device: { v1: { on: (command === 'on') ? true : false } } })
                break;
            default:
                this.debug(`Received invalid switch state command`)
        }
    }
}

module.exports = Switch