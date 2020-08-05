const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class SmokeAlarm extends AlarmDevice {
    async init() {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'binary_sensor'
        this.className = 'smoke'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/smoke_state'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery()
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    publishDiscovery() {
        // Build the MQTT discovery message
        const message = {
            name: this.device.name,
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            json_attributes_topic: this.attributesTopic,
            device_class: this.className
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(this.configTopic, JSON.stringify(message))
    }

    publishData() {
        const smokeState = this.device.data.alarmStatus === 'active' ? 'ON' : 'OFF'
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, smokeState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = SmokeAlarm
