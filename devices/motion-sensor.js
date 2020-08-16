const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class MotionSensor extends AlarmDevice {
    async init() {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'binary_sensor'
        this.className = 'motion'
        this.deviceData.mdl = 'Motion Sensor'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/motion_state'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        if (!this.discoveryData.length) { await this.createDiscoveryData() }
        this.publishDiscoveryData() 
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    createDiscoveryData() {
        const dd = new Object()
        // Build the MQTT discovery message
        dd.message = {
            name: this.device.name,
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            json_attributes_topic: this.attributesTopic,
            device_class: this.className,
            device: this.deviceData
        }
        dd.configTopic = this.configTopic
        this.discoveryData.push(dd)
    }

    publishData() {
        const motionState = this.device.data.faulted ? 'ON' : 'OFF'
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, motionState, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = MotionSensor
