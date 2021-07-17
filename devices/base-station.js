const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class BaseStation extends AlarmDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Alarm Base Station'
        this.deviceData.name = this.device.location.name + ' Base Station'

        this.initVolumeTopics()
    }
    
    // Check if account has access to volume control and initialize topics if so
    async initVolumeTopics() {
        const origVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? this.device.data.volume : 0)
        const testVolume = (origVolume === 1) ? .99 : origVolume+.01
        this.device.setVolume(testVolume)
        await utils.sleep(1)
        if (this.device.data.volume === testVolume) {
            debug('Account has access to set volume on base station, enabling volume control')
            this.device.setVolume(origVolume)
            this.stateTopic_volume = this.deviceTopic+'/volume/state'
            this.commandTopic_volume = this.deviceTopic+'/volume/command'
            this.configTopic_volume = 'homeassistant/number/'+this.locationId+'/'+this.deviceId+'_volume/config'
        } else {
            debug('Account does not have access to set volume on base station, disabling volume control')
        }
    }

    initDiscoveryData() {
        if (this.stateTopic_volume) {
            // Build the MQTT discovery messages
            this.discoveryData.push({
                message: {
                    name: this.device.name+' Volume',
                    unique_id: this.deviceId+'_volume',
                    availability_topic: this.availabilityTopic,
                    payload_available: 'online',
                    payload_not_available: 'offline',
                    state_topic: this.stateTopic_volume,
                    command_topic: this.commandTopic_volume,
                    min: 0,
                    max: 100,
                    device: this.deviceData
                },
                configTopic: this.configTopic_volume
            })
        }

        // Device has no sensors, only publish info data
        this.initInfoDiscoveryData('acStatus')
    }

    publishData() {
        if (this.stateTopic_volume) {
            const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
            this.publishMqtt(this.stateTopic_volume, currentVolume.toString(), true)
        }

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic === this.commandTopic_volume) {
            this.setVolumeLevel(message)
        } else {
            debug('Received unknown command topic '+topic+' for base station: '+this.deviceId)
        }
    }

    // Set volume level on received MQTT command message
    setVolumeLevel(message) {
        const volume = message
        debug('Received set volume level to '+volume+'% for base station: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
                debug('Volume command received but value is not a number')
        } else if (!(message >= 0 && message <= 100)) {
            debug('Volume command received but out of range (0-100)')
        } else {
            this.device.setVolume(volume/100)
        }
    }

}

module.exports = BaseStation