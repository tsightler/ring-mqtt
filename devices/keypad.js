const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Keypad extends AlarmDevice {
    async publish(locationConnected) {
        // Online initialize if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type and device class (set appropriate icon)
        this.deviceData.mdl = 'Security Keypad'

        // Publish discovery message
        if (!this.discoveryData.length) { await this.initDiscoveryData() }
        await this.publishDiscoveryData()

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    initDiscoveryData() {
        // Device has no sensors, only publish info data
        this.initInfoDiscoveryData()
    }

    publishData() {
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
}

module.exports = Keypad
