const RingSocketDevice = require('./base-socket-device')

class RangeExtender extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'acStatus')
        this.deviceData.mdl = 'Z-Wave Range Extender'
        this.deviceData.name = this.device.location.name + ' Range Extender'
    }

    publishData() {
        // This device only has attributes and attribute based entities
        this.publishAttributes()
    }
}

module.exports = RangeExtender