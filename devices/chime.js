const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingPolledDevice = require('./base-polled-device')

class Chime extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        this.data = {
            volume: null,
            snooze: null,
            snooze_minutes: 1440,
            play_ding_sound: 'OFF',
            play_motion_sound: 'OFF'
        }

        // Define entities for this device
        this.entity = {
            ...this.entity,
            volume: {
                component: 'number',
                min: 0,
                max: 11,
                icon: 'hass:volume-high'
            },
            snooze: {
                component: 'switch',
                icon: 'hass:bell-sleep'
            },
            snooze_minutes: {
                component: 'number',
                min: 1,
                max: 1440,
                icon: 'hass:timer-sand'
            },
            play_ding_sound: {
                component: 'switch',
                icon: 'hass:bell-ring'
            },
            play_motion_sound: {
                component: 'switch',
                icon: 'hass:bell-ring'
            },
            info: {
                component: 'sensor',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default }}'
            }
        }
    }

    initAttributeEntities() {
        this.entity.wireless = {
            component: 'sensor',
            device_class: 'signal_strength',
            unit_of_measurement: 'dBm',
            parent_state_topic: 'info/state',
            attributes: 'wireless',
            value_template: '{{ value_json["wirelessSignal"] | default }}'
        }
    }

    publishData(data) {
        const isPublish = data === undefined ? true : false
        const volumeState = this.device.data.settings.volume
        const snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'

        // Polled states are published only if value changes or it's a device publish
        if (volumeState !== this.data.volume || isPublish) { 
            this.publishMqtt(this.entity.volume.state_topic, volumeState.toString(), true)
            this.data.volume = volumeState
        }
        if (snoozeState !== this.data.snooze || isPublish) { 
            this.publishMqtt(this.entity.snooze.state_topic, snoozeState, true)
            this.data.snooze = snoozeState
        }

        // Local states are published only for publish/republish
        if (isPublish) {
            this.publishMqtt(this.entity.snooze_minutes.state_topic, this.data.snooze_minutes.toString(), true)
            this.publishMqtt(this.entity.play_ding_sound.state_topic, this.data.play_ding_sound, true)
            this.publishMqtt(this.entity.play_motion_sound.state_topic, this.data.play_motion_sound, true)
            this.publishAttributes()
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        const deviceHealth = await this.device.getHealth()
        if (deviceHealth) {
            const attributes = {}
            attributes.wirelessNetwork = deviceHealth.wifi_name
            attributes.wirelessSignal = deviceHealth.latest_signal_strength
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            this.publishMqtt(this.entity.info.state_topic, JSON.stringify(attributes), true)
            this.publishAttributeEntities(attributes)
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        switch (topic.split("/").slice(-2).join("/")) {
            case 'snooze/command':
                this.setSnoozeState(message)
                break;
            case 'snooze_minutes/command':
                this.setSnoozeMinutes(message)
                break;    
            case 'volume/command':
                this.setVolumeLevel(message)
                break;
            case 'play_ding_sound/command':
                this.playSound(message, 'ding')
                break;
            case 'play_motion_sound/command':
                this.playSound(message, 'motion')
                break;
            default:
                debug('Somehow received message to unknown state topic for chime '+this.deviceId)
        }
    }

    async setSnoozeState(message) {
        debug('Received set snooze '+message+' for chime Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()

        switch(command) {
            case 'on':
                await this.device.snooze(this.data.snooze_minutes)
                break;
            case 'off': {
                await this.device.clearSnooze()
                break;
            }
            default:
                debug('Received invalid command for set snooze!')
        }
        this.device.requestUpdate()
    }

    setSnoozeMinutes(message) {
        const minutes = message
        debug('Received set snooze minutes to '+minutes+' minutes for chime Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(minutes)) {
                debug('Snooze minutes command received but value is not a number')
        } else if (!(minutes >= 0 && minutes <= 32767)) {
            debug('Snooze minutes command received but out of range (0-1440 minutes)')
        } else {
            this.data.snooze_minutes = parseInt(minutes)
            this.publishMqtt(this.entity.snooze_minutes.state_topic, this.data.snooze_minutes.toString(), true)           
        }
    }

    async setVolumeLevel(message) {
        const volume = message
        debug('Received set volume level to '+volume+' for chime: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
                debug('Volume command received but value is not a number')
        } else if (!(message >= 0 && message <= 11)) {
            debug('Volume command received but out of range (0-11)')
        } else {
            await this.device.setVolume(volume)
            this.device.requestUpdate()
        }
    }

    async playSound(message, chimeType) {
        debug('Receieved play '+chimeType+' chime sound '+message+' for chime Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()

        switch(command) {
            case 'on':
                this.publishMqtt(this.entity[`play_${chimeType}_sound`].state_topic, 'ON', true)
                await this.device.playSound(chimeType)
                await utils.sleep(5)
                this.publishMqtt(this.entity[`play_${chimeType}_sound`].state_topic, 'OFF', true)
                break;
            case 'off': {
                break;
            }
            default:
                debug('Received invalid command for play chime sound!')
        }
    }
}

module.exports = Chime