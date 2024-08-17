import RingSocketDevice from './base-socket-device.js'

export default class Valve extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Water Valve'

        this.entity.valve = {
            component: 'valve'
        }
    }

    publishState() {
        let valveState
        switch(this.device.data.valveState) {
            case 'open':
            case 'closed':
                valveState = this.device.data.valveState
                break;
            default:
                // HA doesn't support broken state so setting unknown state is the best we can do
                valveState = 'None'
        }
        this.mqttPublish(this.entity.valve.state_topic, valveState)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'valve/command':
                this.setValveState(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set valve target state on received MQTT command message
    setValveState(message) {
        this.debug(`Received set valve state ${message}`)
        const command = message.toLowerCase()
       switch(command) {
            case 'open':
            case 'close': {
                let valveState = command === 'open' ? 'opening' : 'closing'
                this.mqttPublish(this.entity.valve.state_topic, valveState)
                this.device.sendCommand(`valve.${command}`)
                break;
            }
            default:
                this.debug('Received invalid command for valve')
        }
    }
}
