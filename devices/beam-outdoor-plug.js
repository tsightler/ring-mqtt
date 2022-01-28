const RingSocketDevice = require('./base-socket-device')

class BeamOutdoorPlug extends RingSocketDevice {
    constructor(deviceInfo, childDevices) {
        super(deviceInfo)
        this.deviceData.mdl = 'Outdoor Smart Plug'

        this.outlet1 = childDevices.find(d => d.data.relToParentZid === "1")
        this.outlet2 = childDevices.find(d => d.data.relToParentZid === "2")
        
        this.entity.outlet1 = {
            component: (this.outlet1.data.categoryId === 2) ? 'light' : 'switch',
            name: `${this.outlet1.name}`,
        }

        this.entity.outlet2 = {
            component: (outlet1.data.categoryId === 2) ? 'light' : 'switch',
            name: `${this.outlet1.name}`,
        }
    }

    publishData() {
        this.publishMqtt(this.entity.outlet1.state_topic, this.device.data.on ? "ON" : "OFF")
        this.publishMqtt(this.entity.outlet2.state_topic, this.device.data.on ? "ON" : "OFF")
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        const entityKey = componentCommand.split('/')[0]
        switch (componentCommand) {
            case 'outlet1/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setOutletState(message, 'outlet1')
                }
                break;
            case 'outlet2/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setOutletState(message, 'outlet2')
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${componentCommand}`)
        }
    }

    // Set switch target state on received MQTT command message
    setOutletState(message, outletId) {
        this.debug(`Received set ${outletId} state ${message}`)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                const duration = 32767
                const on = command === 'on' ? true : false
                const data = on ? { lightMode: 'on', duration } : { lightMode: 'default' }
                this[outletId].sendCommand('light-mode.set', data)
                break;
            }
            default:
                this.debug(`Received invalid ${outletId} state command`)
        }
    }
}

module.exports = BeamOutdoorPlug