const RingSocketDevice = require('./base-socket-device')

class ContactSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

         // Set Home Assistant component type and device class (appropriate icon in UI)
        let entityName = (this.device.data.subCategoryId == 2) ? 'window' : 'door'
        let device_class = 'contact'
        this.deviceData.mdl = 'Contact Sensor'

        // Override icons and and topics
        switch (this.device.deviceType) {
            case 'sensor.zone':
                entityName = 'safety'
                device_class = 'zone'
                this.deviceData.mdl = 'Retrofit Zone'
                break;
            case 'sensor.tilt':
                entityName = 'garage_door'
                device_class = 'tilt'
                this.deviceData.mdl = 'Tilt Sensor'
                break;
        }

        this.entities = {
            [this.entityName]: {
                component: 'binary_sensor',
                device_class: device_class
            }
        }

        this.initInfoEntities(deviceValue)
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
