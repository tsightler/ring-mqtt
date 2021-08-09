const RingSocketDevice = require('./base-socket-device')

class ContactSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

         // Set Home Assistant component type and device class (appropriate icon in UI)
        this.entityName = 'contact'
        this.deviceData.mdl = 'Contact Sensor'
        let device_class = (this.device.data.subCategoryId == 2) ? 'window' : 'door'

        // Override icons and and topics
        switch (this.device.deviceType) {
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

        this.entities[this.entityName] = {
            component: 'binary_sensor',
            device_class: device_class,
            unique_id: this.deviceId
        }

        this.initInfoEntities()
    }

    publishData() {
        const contactState = this.device.data.faulted ? 'ON' : 'OFF'
        this.publishMqtt(this.entities[this.entityName].state_topic, contactState, true)
        this.publishAttributes()
    }
}

module.exports = ContactSensor
