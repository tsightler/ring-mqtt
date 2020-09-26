const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Keypad extends AlarmDevice {
    async publish(locationConnected) {
        // Only publish if location websocket is connected
        if (!locationConnected) { return }

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Security Keypad'

        if (this.config.enable_volume) {
            // Build required MQTT topics for volume control
            this.stateTopic_audio = this.deviceTopic+'/audio/state'
            this.commandTopic_audio = this.deviceTopic+'/audio/command'
            this.stateTopic_audio_volume = this.deviceTopic+'/audio/volume_state'
            this.commandTopic_audio_volume = this.deviceTopic+'/audio/volume_command'
            this.configTopic_audio = 'homeassistant/light/'+this.locationId+'/'+this.deviceId+'_audio/config'
        }

        // Publish device data
        this.publishDevice()
    }

    initDiscoveryData() {
        // Build the MQTT discovery messages if volume control is enabled
        if (this.stateTopic_audio) {
            this.discoveryData.push({
                message: {
                    name: this.device.name+' Audio Settings',
                    unique_id: this.deviceId+'_audio',
                    availability_topic: this.availabilityTopic,
                    payload_available: 'online',
                    payload_not_available: 'offline',
                    state_topic: this.stateTopic_audio,
                    command_topic: this.commandTopic_audio,
                    brightness_scale: 100,
                    brightness_state_topic: this.stateTopic_audio_volume,
                    brightness_command_topic: this.commandTopic_audio_volume,
                    device: this.deviceData
                },
                configTopic: this.configTopic_audio
            })
        }
        
        // Device has no sensors, only publish info data
        this.initInfoDiscoveryData()
    }

    publishData() {
        if (this.stateTopic_audio) {
            const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
            const currentState = (currentVolume > 0) ? "ON" : "OFF" 
            // Publish device state
            this.publishMqtt(this.stateTopic_audio, currentState, true)
            this.publishMqtt(this.stateTopic_audio_volume, currentVolume.toString(), true)
            this.volumeUpdatePending = false
        }

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic == this.commandTopic_audio) {
            this.setAudioState(message)
        } else if (topic == this.commandTopic_audio_volume) {
            this.setVolumeLevel(message)
        } else {
            debug('Somehow received unknown command topic '+topic+' for keypad Id: '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    async setAudioState(message) {
        if (!this.volumeUpdatePending) {
            const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
            const currentState = (currentVolume > 0) ? "ON" : "OFF"
            const command = message.toUpperCase()
            switch(command) {
                case 'ON':
                case 'OFF': {
                    if (command !== currentState) {
                        debug('Received command to turn '+command+' audio for keypad Id: '+this.deviceId)
                        // For off set volume to zero, for on set to current volume or 65% if unknown
                        const volume = command === 'OFF' ? 0 : currentVolume === 0 ? .65 : currentVolume
                        debug('Setting volume level to '+volume*100+'%')
                        this.device.setVolume(volume)
                    }
                    break;
                }
                default:
                    debug('Received invalid audio command for keypad!')
            }
        }
    }

    // Set switch target state on received MQTT command message
    setVolumeLevel(message) {
        this.volumeUpdatePending = true
        const volume = message
        debug('Received set volume level to '+volume+'% for keypad Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
                debug('Volume command received but not a number!')
        } else if (!(message >= 0 && message <= 100)) {
            debug('Volume command received but out of range (0-100)!')
        } else {
            this.device.setVolume(volume/100)
        }
    }

}

module.exports = Keypad
