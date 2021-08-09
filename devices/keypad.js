const debug = require('debug')('ring-mqtt')
const RingSocketDevice = require('./base-socket-device')

class Keypad extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo)
        this.deviceData.mdl = 'Security Keypad'

        // Eventually remove this but for now this attempts to delete the old light component based volume control from Home Assistant
        this.publishMqtt('homeassistant/light/'+this.locationId+'/'+this.deviceId+'_audio/config', '', false)

        this.entities.volume = {
            component: 'number',
            min: 0,
            max: 100,
            icon: 'hass:volume-high'
        }

        this.initInfoEntities()
    }

    publishData() {
        const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
        this.publishMqtt(this.entities.volume.state_topic, currentVolume.toString(), true)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        topic = topic.split('/')
        const component = topic[topic.length - 2]
        if (component === 'volume') {
            this.setVolumeLevel(message)
        } else {
            debug('Received unknown command topic '+topic+' for keypad: '+this.deviceId)
        }
    }

    // Set volume level on received MQTT command message
    setVolumeLevel(message) {
        const volume = message
        debug('Received set volume level to '+volume+'% for keypad: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
                debug('Volume command received but value is not a number')
        } else if (!(message >= 0 && message <= 100)) {
            debug('Volume command received but out of range (0-100)')
        } else {
            this.device.setVolume(volume/100)
        }
    }

}

module.exports = Keypad