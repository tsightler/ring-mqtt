const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class RangeExtender extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Z-Wave Range Extender'
        this.deviceData.name = this.device.location.name + ' Range Extender'

        // Publish device data
        this.publishDevice()
    }

    initDiscoveryData() {
        // Device has no sensors, only publish info data
        this.initInfoDiscoveryData('acStatus')
    }

    publishData() {
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = RangeExtender