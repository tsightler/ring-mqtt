const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class SmokeCoListener extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type and device class (set appropriate icon)
        this.className_smoke = 'smoke'
        this.className_co = 'gas'
        this.component = 'binary_sensor'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Smoke & CO Listener'

        // Build a save MQTT topics
        this.stateTopic_smoke = this.deviceTopic+'/smoke/state'
        this.stateTopic_co = this.deviceTopic+'/co/state'
        this.configTopic_smoke = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_smoke/config'
        this.configTopic_co = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_gas/config'

        // Publish device data
        this.publishDevice()
    }

    initDiscoveryData() {
        // Build the MQTT discovery message for smoke detector
        this.discoveryData.push({
            message: {
                name: this.device.name+' Smoke',
                unique_id: this.deviceId+'_'+this.className_smoke,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_smoke,
                device_class: this.className_smoke,
                device: this.deviceData
            },
            configTopic: this.configTopic_smoke
        })

        // Build the MQTT discovery message for co detector
        this.discoveryData.push({
            message: {
                name: this.device.name+' CO',
                unique_id: this.deviceId+'_'+this.className_co,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_co,
                device_class: this.className_co,
                device: this.deviceData
            },
            configTopic: this.configTopic_co
        })

        this.initInfoDiscoveryData()
    }

    publishData() {
        const smokeState = this.device.data.smoke && this.device.data.smoke.alarmStatus === 'active' ? 'ON' : 'OFF'
        const coState = this.device.data.co && this.device.data.co.alarmStatus === 'active' ? 'ON' : 'OFF'

        // Publish sensor states
        this.publishMqtt(this.stateTopic_smoke, smokeState, true)
        this.publishMqtt(this.stateTopic_co, coState, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = SmokeCoListener
