import RingSocketDevice from './base-socket-device.js'

export default class Bridge extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm', 'commStatus')
        this.deviceData.mdl = 'Bridge'
        this.deviceData.name = this.device.location.name + ' Bridge'
    }

    publishState() {
        // This device only has attributes and attribute based entities
        this.publishAttributes()
    }
}
