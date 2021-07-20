const AlarmDevice = require('./alarm-device')

class Siren extends AlarmDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'binary_sensor'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Siren'

        // Build required MQTT topics
        this.stateTopic = this.deviceTopic+'/siren/state'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'
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
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.initInfoDiscoveryData()
    }

    publishData() {
        const sirenState = this.device.data.sirenStatus === 'active' ? 'ON' : 'OFF'
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, sirenState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = Siren