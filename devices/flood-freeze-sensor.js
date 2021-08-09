const RingSocketDevice = require('./base-socket-device')

class FloodFreezeSensor extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Flood & Freeze Sensor'

        this.entities.flood = {
            component: 'binary_sensor',
            device_class: 'moisture'
        }
        this.entities.freeze = {
            component: 'binary_sensor',
            device_class: 'cold'
        }
        this.initInfoEntities()
    }
        
    publishData() {
        const floodState = this.device.data.flood && this.device.data.flood.faulted ? 'ON' : 'OFF'
        const freezeState = this.device.data.freeze && this.device.data.freeze.faulted ? 'ON' : 'OFF'
        this.publishMqtt(this.entities.flood.state_topic, floodState, true)
        this.publishMqtt(this.entities.freeze.state_topic, freezeState, true)
        this.publishAttributes()
    }
}

module.exports = FloodFreezeSensor