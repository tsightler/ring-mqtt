const RingSocketDevice = require('./base-socket-device')

class ContactSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        let device_class = 'None'

        // Override icons and and topics
        switch (this.device.deviceType) {
            case 'sensor.contact':
                this.entityName = 'contact'
                this.deviceData.mdl = 'Contact Sensor'
                device_class = (this.device.data.subCategoryId == 2) ? 'window' : 'door'
                break;
            case 'sensor.zone':
                this.entityName = 'zone'
                this.deviceData.mdl = 'Retrofit Zone'
                device_class = 'safety'
                break;
            case 'sensor.tilt':
                this.entityName = 'tilt'
                this.deviceData.mdl = 'Tilt Sensor'
                device_class = 'garage_door'
                break;
        }

        this.entity[this.entityName] = {
            component: 'binary_sensor',
            device_class: device_class,
            isLegacyEntity: true  // Legacy compatibility
        }
    }

    publishData() {
        const contactState = this.device.data.faulted ? 'ON' : 'OFF'
        this.publishMqtt(this.entity[this.entityName].state_topic, contactState, true)
        this.publishAttributes()
    }
}

module.exports = ContactSensor
