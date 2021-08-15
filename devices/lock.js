const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Lock extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Lock'

        this.entity.lock = {
            component: 'lock',
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        var lockState
        switch(this.device.data.locked) {
            case 'locked':
                lockState = 'LOCKED'
                break;
            case 'unlocked':
                lockState = 'UNLOCKED'
                break;
            default:
                lockState = 'UNKNOWN'
        }
        this.publishMqtt(this.entity.lock.state_topic, lockState, true)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'lock/command':
                this.setLockState(message)
                break;
            default:
                debug('Received unknown command topic '+topic+' for lock: '+this.deviceId)
        }
    }

    // Set lock target state on received MQTT command message
    setLockState(message) {
        debug('Received set lock state '+message+' for lock: '+this.deviceId)
        debug('Location: '+ this.locationId)
        const command = message.toLowerCase()
        switch(command) {
            case 'lock':
            case 'unlock':
                this.device.sendCommand(`lock.${command}`);
                break;
            default:
                debug('Received invalid command for lock: '+this.deviceId)
        }
    }
}

module.exports = Lock