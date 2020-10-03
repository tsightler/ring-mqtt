const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class ContactSensor extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        this.component = 'binary_sensor'
        switch (this.device.deviceType) {
            case 'sensor.zone':
                // Home Assistant component type and device class (set appropriate icon)
                this.className = 'safety'
                this.sensorType = 'zone'
                this.deviceData.mdl = 'Retrofit Zone'
                break;
            case 'sensor.tilt':
                // Home Assistant component type and device class (set appropriate icon)
                this.className = 'garage_door'
                this.sensorType = 'tilt'
                this.deviceData.mdl = 'Tilt Sensor'
                break;
            default:
                this.className = (this.device.data.subCategoryId == 2) ? 'window' : 'door'
                this.sensorType = 'contact'
                this.deviceData.mdl = 'Contact Sensor'
        }

        // Build required MQTT topics
        this.stateTopic = this.deviceTopic+'/'+this.sensorType+'/state'
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
        const contactState = this.device.data.faulted ? 'ON' : 'OFF'
        // Publish sensor state
        this.publishMqtt(this.stateTopic, contactState, true)
        // Publish attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = ContactSensor
