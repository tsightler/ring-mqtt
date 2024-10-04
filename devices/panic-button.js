import RingSocketDevice from './base-socket-device.js'

export default class PanicButton extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Panic Button'


        // Listen to raw data updates for all devices and log any events
        this.device.location.onDataUpdate.subscribe(async (message) => {
            if (!this.isOnline()) { return }

            if (message.datatype === 'DeviceInfoDocType' &&
                message.body?.[0]?.general?.v2?.zid === this.deviceId
            ) {
                this.debug(JSON.stringify(message), 'data')
            }
        })

    }

    publishState() {
        // This device only has attributes and attribute based entities
        this.publishAttributes()
    }
}