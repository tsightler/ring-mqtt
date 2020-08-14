const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class SmokeCoListener extends AlarmDevice {
    async init() {
        // Set Home Assistant component type and device class (appropriate icon in UI)
        this.className_smoke = 'smoke'
        this.className_co = 'gas'
        this.component = 'binary_sensor'

        // Build a save MQTT topics for future use
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic_smoke = this.deviceTopic+'/smoke_state'
        this.stateTopic_co = this.deviceTopic+'/co_state'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic_smoke = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_smoke/config'
        this.configTopic_co = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'_gas/config'

        this.publishDiscovery()
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    publishDiscovery() {

        // Build the MQTT discovery messages
        const message_smoke = {
            name: this.device.name+' - Smoke',
            unique_id: this.deviceId+'_'+this.className_smoke,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic_smoke,
            json_attributes_topic: this.attributesTopic,
            device_class: this.className_smoke
        }

        const message_co = {
            name: this.device.name+' - CO',
            unique_id: this.deviceId+'_'+this.className_co,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic_co,
            json_attributes_topic: this.attributesTopic,
            device_class: this.className_co
        }

        // Publish smoke sensor
        debug('HASS config topic: '+this.configTopic_smoke)
        debug(message_smoke)
        this.publishMqtt(this.configTopic_smoke, JSON.stringify(message_smoke))

        // Publish CO sensor
        debug('HASS config topic: '+this.configTopic_co)
        debug(message_co)
        this.publishMqtt(this.configTopic_co, JSON.stringify(message_co))
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
