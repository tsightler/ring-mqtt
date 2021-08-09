const RingSocketDevice = require('./base-socket-device')

class RangeExtender extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Z-Wave Range Extender'
        this.deviceData.name = this.device.location.name + ' Range Extender'
        
        this.initAttributeEntities('acStatus')
    }

    publishData() {
        // This device only has attributes and attribute based entities
        this.publishAttributes()
    }
}

module.exports = RangeExtender