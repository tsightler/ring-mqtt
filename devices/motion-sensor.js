const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class MotionSensor extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'binary_sensor'
        this.className = 'motion'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Motion Sensor'

        // Build required MQTT topics
        this.stateTopic = this.deviceTopic+'/motion/state'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish device data
        this.publishDevice()
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
                device_class: this.className,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.initInfoDiscoveryData()
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
