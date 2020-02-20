const debug = require('debug')('ring-mqtt')
const colors = require( 'colors/safe' )
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class FloodFreezeSensor extends AlarmDevice {

    async init(mqttClient) {
        // Set Home Assistant component type and device class (appropriate icon in UI)
        this.className_flood = 'moisture'
        this.className_freeze = 'cold'
        this.component = 'binary_sensor'

        // Build a save MQTT topics for future use
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic_flood = this.deviceTopic+'/flood_state'
        this.stateTopic_freeze = this.deviceTopic+'/freeze_state'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic_flood = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_flood/config'
        this.configTopic_freeze = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_freeze/config'

        this.publishDiscovery(mqttClient)
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice(mqttClient)
    }

    publishDiscovery(mqttClient) {

        // Build the MQTT discovery messages
        const message_flood = {
            name: this.device.name+' - Flood',
            unique_id: this.deviceId+'_'+this.className_flood,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic_flood,
            json_attributes_topic: this.attributesTopic,
            device_class: this.className_flood
        }

        const message_freeze = {
            name: this.device.name+' - Freeze',
            unique_id: this.deviceId+'_'+this.className_freeze,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic_freeze,
            json_attributes_topic: this.attributesTopic,
            device_class: this.className_freeze
        }

        // Publish flood sensor
        debug('HASS config topic: '+this.configTopic_flood)
        debug(message_flood)
        this.publishMqtt(mqttClient, this.configTopic_flood, JSON.stringify(message_flood))

        // Publish freeze sensor
        debug('HASS config topic: '+this.configTopic_freeze)
        debug(message_freeze)
        this.publishMqtt(mqttClient, this.configTopic_freeze, JSON.stringify(message_freeze))
    }

    publishData(mqttClient) {
        const floodState = this.device.data.flood && this.device.data.flood.faulted ? 'ON' : 'OFF'
        const freezeState = this.device.data.freeze && this.device.data.freeze.faulted ? 'ON' : 'OFF'

        // Publish sensor states
        this.publishMqtt(mqttClient, this.stateTopic_flood, floodState, true)
        this.publishMqtt(mqttClient, this.stateTopic_freeze, freezeState, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes(mqttClient)
    }
}

module.exports = FloodFreezeSensor
