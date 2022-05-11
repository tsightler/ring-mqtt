const RingSocketDevice = require('./base-socket-device')
const utils = require('../lib/utils')

class BaseStation extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm', 'acStatus')
        this.deviceData.mdl = 'Alarm Base Station'
        this.deviceData.name = this.device.location.name + ' Base Station'

        this.detectVolumeAccess()
    }

    async detectVolumeAccess() {
        const origVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? this.device.data.volume : 0)
        const testVolume = (origVolume === 1) ? .99 : origVolume+.01
        this.device.setVolume(testVolume)
        await utils.sleep(1)
        if (this.device.data.volume === testVolume) {
            this.debug('Account has access to set volume on base station, enabling volume control')
            this.device.setVolume(origVolume)
            this.entity.volume = {
                component: 'number',
                min: 0,
                max: 100,
                icon: 'hass:volume-high'
            }
        } else {
            this.debug('Account does not have access to set volume on base station, disabling volume control')
        }
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false

        if (this.entity.hasOwnProperty('volume')) {
            const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
            this.mqttPublish(this.entity.volume.state_topic, currentVolume.toString())

            // Eventually remove this but for now this attempts to delete the old light component based volume control from Home Assistant
            if (isPublish) {
                this.mqttPublish('homeassistant/light/'+this.locationId+'/'+this.deviceId+'_audio/config', '', false)
            }
        }
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        switch (command) {
            case 'volume/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setVolumeLevel(message)
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set volume level on received MQTT command message
    setVolumeLevel(message) {
        const volume = message
        this.debug(`Received set volume level to ${volume}%`)
        if (isNaN(message)) {
                this.debug('Volume command received but value is not a number')
        } else if (!(message >= 0 && message <= 100)) {
            this.debug('Volume command received but out of range (0-100)')
        } else {
            this.device.setVolume(volume/100)
        }
    }

}

module.exports = BaseStation