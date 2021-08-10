const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingPolledDevice = require('./base-polled-device')

class Chime extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Define entities for this device
        this.entities = {
            volume: {
                component: 'number',
                state: null,
                min: 0,
                max: 11,
                icon: 'hass:volume-high'
            },
            snooze: {
                component: 'switch',
                state: null,
                icon: 'hass:bell-sleep'
            },
            snooze_minutes: {
                component: 'number',
                state: 1440,
                min: 1,
                max: 1440,
                icon: 'hass:timer-sand'
            },
            play_ding_sound: {
                component: 'switch',
                state: 'OFF',
                icon: 'hass:bell-ring'
            },
            play_motion_sound: {
                component: 'switch',
                state: 'OFF',
                icon: 'hass:bell-ring'
            },
            wireless: {
                component: 'sensor',
                device_class: 'signal_strength',
                unit_of_measurement: 'dBm',
                parent_state_topic: 'info/state',
                value_template: '{{ value_json["wirelessSignal"] | default }}',
            },
            info: {
                component: 'sensor',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default }}'
            }
        }
    }

    // Perforsms device publish and re-publish functions (subscribed vs not subscribed)
    async publish() {
        await this.publishDiscovery()
        await this.online()

        if (this.subscribed) {
            this.publishData(true)
            this.publishInfoState()
        } else {
            this.subscribed = true
            this.device.onData.subscribe(() => { 
                this.publishData() 
            })
            this.publishInfoState()
            this.schedulePublishInfo()
            this.monitorHeartbeat()
        }
    }

    async publishData(republish) {
        // Reset heartbeat counter on every polled state
        this.heartbeat = 3
        
        const volumeState = this.device.data.settings.volume
        const snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'

        // Polled states are published only if value changes or it's a republish
        if (volumeState !== this.entities.volume.state || republish) { 
            this.publishMqtt(this.entities.volume.state_topic, volumeState.toString(), true)
            this.entities.volume.state = volumeState
        }
        if (snoozeState !== this.entities.snooze.state || republish) { 
            this.publishMqtt(this.entities.snooze.state_topic, snoozeState, true)
            this.entities.snooze.state = snoozeState
        }

        // Realtime states are published only for publish/republish
        if (!this.subscribed || republish) {
            this.publishMqtt(this.entities.snooze_minutes.state_topic, this.entities.snooze_minutes.state.toString(), true)
            this.publishMqtt(this.entities.play_ding_sound.state_topic, this.entities.play_ding_sound.state, true)
            this.publishMqtt(this.entities.play_motion_sound.state_topic, this.entities.play_motion_sound.state, true)
        }

    }

    // Publish device data to info topic
    async publishInfoState() {
        const deviceHealth = await this.device.getHealth()
        if (deviceHealth) {
            const attributes = {}
            attributes.wirelessNetwork = deviceHealth.wifi_name
            attributes.wirelessSignal = deviceHealth.latest_signal_strength
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            this.publishMqtt(this.entities.info.state_topic, JSON.stringify(attributes), true)
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        const matchTopic = topic.split("/").slice(-2).join("/")
        switch (matchTopic) {
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
                await this.device.snooze(this.entities.snooze_minutes.state)
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
            this.entities.snooze_minutes.state = parseInt(minutes)
            this.publishMqtt(this.entities.snooze_minutes.state_topic, this.entities.snooze_minutes.state.toString(), true)           
        }
    }

    // Set volume level on received MQTT command message
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
                this.publishMqtt(this.entities[`play_${chimeType}_sound`].state_topic, 'ON', true)
                await this.device.playSound(chimeType)
                await utils.sleep(5)
                this.publishMqtt(this.entities[`play_${chimeType}_sound`].state_topic, 'OFF', true)
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