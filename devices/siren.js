const RingSocketDevice = require('./base-socket-device')

class Siren extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Siren'
        
        this.entity.siren = {
            component: 'switch',
            icon: 'mdi:alarm-light',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData(data) {
        const isPublish = data === undefined ? true : false
        if (isPublish) {
            // Eventually remove this but for now this attempts to delete the old siren binary_sensor
            this.publishMqtt('homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'_siren/config', '', false)
        }

        const sirenState = this.device.data.sirenStatus === 'active' ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.siren.state_topic, sirenState, true)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'siren/command':
                this.setSirenState(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${componentCommand}`)
        }
    }

    async setSirenState(message) {
        switch(message.toLowerCase()) {
            case 'on':
            case 'off':
                this.debug(`Received set siren state ${message}`)
                const command = (message.toLowerCase() === 'on') ? 'start' : 'stop' 
                this.device.sendCommand(`siren-test.${command}`)
                break;
            default:
                this.debug('Received invalid command for siren!')
        }
    }
}

module.exports = Siren