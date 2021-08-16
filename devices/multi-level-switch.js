const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class MultiLevelSwitch extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Dimming Light'
        
        this.entity.light = {
            component: 'light',
            brightness_scale: 100,
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        const switchState = this.device.data.on ? "ON" : "OFF"
        const switchLevel = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(100 * this.device.data.level) : 0) 
        this.publishMqtt(this.entity.light.state_topic, switchState, true)
        this.publishMqtt(this.entity.light.brightness_state_topic, switchLevel.toString(), true)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'light/command':
                this.setSwitchState(message)
                break;
            case 'light/brightness_command':
                this.setSwitchLevel(message)
                break;
            default:
                debug('Received unknown command topic '+topic+' for light: '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setSwitchState(message) {
        debug('Received set switch state '+message+' for switch: '+this.deviceId)
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
        debug('Received set switch level to '+level+' for switch: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
             debug('Brightness command received but not a number!')
        } else if (!(message >= 0 && message <= 100)) {
            debug('Brightness command received but out of range (0-100)!')
        } else {
            this.device.setInfo({ device: { v1: { level: level / 100 } } })
        }
    }
}

module.exports = MultiLevelSwitch