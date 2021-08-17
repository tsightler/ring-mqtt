const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const RingSocketDevice = require('./base-socket-device')

class BaseStation extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'acStatus')
        this.deviceData.mdl = 'Alarm Base Station'
        this.deviceData.name = this.device.location.name + ' Base Station'

        this.initVolumeEntity()
    }
    
    // Check if account has access to control base state volume and initialize topics if so
    async initVolumeEntity() {
        const origVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? this.device.data.volume : 0)
        const testVolume = (origVolume === 1) ? .99 : origVolume+.01
        this.device.setVolume(testVolume)
        await utils.sleep(1)
        if (this.device.data.volume === testVolume) {
            debug('Account has access to set volume on base station, enabling volume control')
            this.device.setVolume(origVolume)
            this.entity.volume = {
                component: 'number',
                min: 0,
                max: 100,
                icon: 'hass:volume-high'
            }
        } else {
            debug('Account does not have access to set volume on base station, disabling volume control')
        }
    }

    publishData(data) {
        const isPublish = data === undefined ? true : false

        if (this.entity.hasOwnProperty('volume')) {
            const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
            this.publishMqtt(this.entity.volume.state_topic, currentVolume.toString(), true)

            // Eventually remove this but for now this attempts to delete the old light component based volume control from Home Assistant
            if (isPublish) {
                this.publishMqtt('homeassistant/light/'+this.locationId+'/'+this.deviceId+'_audio/config', '', false)
            }
        }
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        const entityKey = componentCommand.split('/')[0]
        switch (componentCommand) {
            case 'volume/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setVolumeLevel(message)
                }
                break;
            default:
                debug('Received unknown command topic '+topic+' for keypad: '+this.deviceId)
        }
    }

    // Set volume level on received MQTT command message
    setVolumeLevel(message) {
        const volume = message
        debug('Received set volume level to '+volume+'% for base station: '+this.deviceId)
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

module.exports = BaseStation