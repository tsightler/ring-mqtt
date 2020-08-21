const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class FloodFreezeSensor extends AlarmDevice {
    async publish(locationConnected) {
        // Online initialize if location websocket is connected
        if (!locationConnected) { return }

        // Set Home Assistant component type and device class (appropriate icon in UI)
        this.className_flood = 'moisture'
        this.className_freeze = 'cold'
        this.component = 'binary_sensor'
        this.deviceData.mdl = 'Flood & Freeze Sensor'

        // Build a save MQTT topics for future use
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic_flood = this.deviceTopic+'/flood_state'
        this.stateTopic_freeze = this.deviceTopic+'/freeze_state'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic_flood = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_flood/config'
        this.configTopic_freeze = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_freeze/config'

        // Publish discovery messages
        if (!this.discoveryData.length) { await this.initDiscoveryData() }
        await this.publishDiscoveryData()

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    initDiscoveryData() {
        // Build the MQTT discovery messages
        this.discoveryData.push({
            message: {
                name: this.device.name+' - Flood',
                unique_id: this.deviceId+'_'+this.className_flood,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_flood,
                json_attributes_topic: this.attributesTopic,
                device_class: this.className_flood,
                device: this.deviceData
            },
            configTopic: this.configTopic_flood
        })

        this.discoveryData.push({
            message: {
                name: this.device.name+' - Freeze',
                unique_id: this.deviceId+'_'+this.className_freeze,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_freeze,
                json_attributes_topic: this.attributesTopic,
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
