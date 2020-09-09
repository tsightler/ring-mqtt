const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Lock extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type
        this.component = 'lock'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Lock'

        // Build required MQTT topics
        this.stateTopic = this.deviceTopic+'/lock/state'
        this.commandTopic = this.deviceTopic+'/lock/command'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish device data
        this.publishDevice()
    }

    initDiscoveryData() {
        // Build the MQTT discovery message
        this.discoveryData.push({
            message: {
                name: this.device.name,
                unique_id: this.deviceId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic,
                command_topic: this.commandTopic,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })
        
        this.initInfoDiscoveryData()
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
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, lockState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message) {
        this.setLockState(message)
    }

    // Set lock target state on received MQTT command message
    setLockState(message) {
        debug('Received set lock state '+message+' for lock Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        const command = message.toLowerCase()

        switch(command) {
            case 'lock':
            case 'unlock':
                this.device.sendCommand(`lock.${command}`);
                break;
            default:
                debug('Received invalid command for lock!')
        }
    }
}

module.exports = Lock
