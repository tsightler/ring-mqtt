const RingSocketDevice = require('./base-socket-device')
const { RingDeviceType } = require('@tsightler/ring-client-api')

class BinarySensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')

        let device_class = 'None'

        // Override icons and and topics
        switch (this.device.deviceType) {
            case RingDeviceType.ContactSensor:
                this.entityName = 'contact'
                this.deviceData.mdl = 'Contact Sensor'
                device_class = (this.device.data.subCategoryId == 2) ? 'window' : 'door'
                break;
            case RingDeviceType.MotionSensor:
                this.entityName = 'motion'
                this.deviceData.mdl = 'Motion Sensor',
                device_class = 'motion'
                break;
            case RingDeviceType.RetrofitZone:
                this.entityName = 'zone'
                this.deviceData.mdl = 'Retrofit Zone'
                device_class = 'safety'
                break;
            case RingDeviceType.TiltSensor:
                this.entityName = 'tilt'
                this.deviceData.mdl = 'Tilt Sensor'
                device_class = 'garage_door'
                break;
            case RingDeviceType.GlassbreakSensor:
                this.entityName = 'glassbreak'
                this.deviceData.mdl = 'Glassbreak Sensor'
                device_class = 'safety'
                break;
            default:
                if (this.device.name.toLowerCase().includes('motion')) {
                    this.entityName = 'motion'
                    this.deviceData.mdl = 'Motion Sensor',
                    device_class = 'motion'
                } else {
                    this.entityName = 'binary_sensor'
                    this.deviceData.mdl = 'Generic Binary Sensor'
                    device_class = 'None'
                }
        }

        this.entity[this.entityName] = {
            component: 'binary_sensor',
            device_class: device_class,
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        const contactState = this.device.data.faulted ? 'ON' : 'OFF'
        this.mqttPublish(this.entity[this.entityName].state_topic, contactState)
        this.publishAttributes()
    }
}

module.exports = BinarySensor
