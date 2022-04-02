const RingSocketDevice = require('./base-socket-device')

class Keypad extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Security Keypad'

        this.entity.volume = {
            component: 'number',
            min: 0,
            max: 100,
            icon: 'hass:volume-high'
        }
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false
        if (isPublish) {
            // Eventually remove this but for now this attempts to delete the old light component based volume control from Home Assistant
            this.mqttPublish('homeassistant/light/'+this.locationId+'/'+this.deviceId+'_audio/config', '', false)
        }

        const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
        this.mqttPublish(this.entity.volume.state_topic, currentVolume.toString())
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'volume/command':
                this.setVolumeLevel(message)
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

module.exports = Keypad