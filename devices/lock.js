const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Lock extends AlarmDevice {
    async init() {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'lock'
        this.deviceData.mdl = 'Lock'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/lock_state'
        this.commandTopic = this.deviceTopic+'/lock_command'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message
        if (!this.discoveryData.length) { await this.initDiscoveryData() }
        await this.publishDiscoveryData()

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()

        // Subscribe to device command topic
        this.mqttClient.subscribe(this.commandTopic)
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
                json_attributes_topic: this.attributesTopic,
                command_topic: this.commandTopic,
                device: this.deviceData
            },
            configTopic: this.configTopic_flood
        })
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
