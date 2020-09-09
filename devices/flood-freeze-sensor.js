const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class FloodFreezeSensor extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Set Home Assistant component type and device class (appropriate icon in UI)
        this.className_flood = 'moisture'
        this.className_freeze = 'cold'
        this.component = 'binary_sensor'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Flood & Freeze Sensor'

        // Build a save MQTT topics
        this.stateTopic_flood = this.deviceTopic+'/flood/state'
        this.stateTopic_freeze = this.deviceTopic+'/freeze/state'
        this.configTopic_flood = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_flood/config'
        this.configTopic_freeze = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_freeze/config'

        // Publish device data
        this.publishDevice()
    }

    initDiscoveryData() {
        // Build the MQTT discovery messages
        this.discoveryData.push({
            message: {
                name: this.device.name+' Flood',
                unique_id: this.deviceId+'_'+this.className_flood,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_flood,
                device_class: this.className_flood,
                device: this.deviceData
            },
            configTopic: this.configTopic_flood
        })

        this.discoveryData.push({
            message: {
                name: this.device.name+' Freeze',
                unique_id: this.deviceId+'_'+this.className_freeze,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_freeze,
                device_class: this.className_freeze,
                device: this.deviceData
            },
            configTopic: this.configTopic_freeze
        })

        this.initInfoDiscoveryData()
    }

    publishData() {
        const floodState = this.device.data.flood && this.device.data.flood.faulted ? 'ON' : 'OFF'
        const freezeState = this.device.data.freeze && this.device.data.freeze.faulted ? 'ON' : 'OFF'

        // Publish sensor states
        this.publishMqtt(this.stateTopic_flood, floodState, true)
        this.publishMqtt(this.stateTopic_freeze, freezeState, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = FloodFreezeSensor
