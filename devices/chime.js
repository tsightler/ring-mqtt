const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const clientApi = require('../node_modules/ring-client-api/lib/api/rest-client').clientApi
const RingPolledDevice = require('./base-polled-device')

class Chime extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'chime')

        this.entities = {
            volume: {
                type: 'number',
                state: null,
                min: 0,
                max: 11,
                icon: 'hass:volume-high'
            },
            snooze: {
                type: 'switch',
                state: null,
                icon: 'hass:bell-sleep'
            },
            snooze_minutes: {
                type: 'number',
                state: 1440,
                min: 1,
                max: 1440,
                icon: 'hass:timer-sand'
            },
            play_ding_sound: {
                type: 'switch',
                state: 'OFF',
                icon: 'hass:bell-ring'
            },
            play_motion_sound: {
                type: 'switch',
                state: 'OFF',
                icon: 'hass:bell-ring'
            },
            wireless: {
                type: 'sensor',
                deviceClass: 'signal_strength',
                unitOfMeasurement: 'dBm',
                parentAttributeEntity: 'info',
                valueTemplate: '{{ value_json["wirelessSignal"] | default }}',
            },
            info: {
                type: 'sensor',
                deviceClass: 'timestamp',
                valueTemplate: '{{ value_json["lastUpdate"] | default }}'
            }
        }
    }

    // Perforsms device publish and re-publish functions (subscribed vs not subscribed)
    async publish() {
        const debugMsg = (this.availabilityState === 'init') ? 'Publishing new ' : 'Republishing existing '
        debug(debugMsg+'device id: '+this.deviceId)

        await this.publishDevice()
        await this.online()
        
        if (this.subscribed) {
            this.publishData(true)
            this.publishInfoState()
        } else {
            // Subscribe to data updates for device
            this.device.onData.subscribe(() => { this.publishData() })
            this.publishInfoState()
            this.schedulePublishInfo()
            this.monitorHeartbeat()
            this.subscribed = true
        }
    }

    async publishData(republish) {
        // Reset heartbeat counter on every polled state
        this.heartbeat = 3
        
        const volumeState = this.device.data.settings.volume
        const snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'

        // Polled states are published only if value changes or it's a republish
        if (volumeState !== this.entities.volume.state || republish) { 
            this.publishMqtt(this.entities.volume.stateTopic, volumeState.toString(), true)
            this.entities.volume.state = volumeState
        }
        if (snoozeState !== this.entities.snooze.state || republish) { 
            this.publishMqtt(this.entities.snooze.stateTopic, snoozeState, true)
            this.entities.snooze.state = snoozeState
        }

        // Realtime states are published only for publish/republish
        if (!this.subscribed || republish) {
            this.publishMqtt(this.entities.snooze_minutes.stateTopic, this.entities.snooze_minutes.state.toString(), true)
            this.publishMqtt(this.entities.play_ding_sound.stateTopic, this.entities.play_ding_sound.state, true)
            this.publishMqtt(this.entities.play_motion_sound.stateTopic, this.entities.play_motion_sound.state, true)
        }

    }

    // Publish device data to info topic
    async publishInfoState() {
        const response = 
            await this.device.restClient.request({
                url: clientApi(`chimes/${this.device.id}/health`),
                responseType: 'json'
            }).catch()
        if (response) {
            const attributes = {}
            attributes.wirelessNetwork = response.device_health.wifi_name
            attributes.wirelessSignal = response.device_health.latest_signal_strength
            attributes.firmwareStatus = response.device_health.firmware
            attributes.lastUpdate = response.device_health.updated_at.slice(0,-6)+"Z"
            this.publishMqtt(this.entities.info.stateTopic, JSON.stringify(attributes), true)
        }
    }

    // Publish heath state every 5 minutes when online
    async schedulePublishInfo() {
        await utils.sleep(this.availabilityState === 'offline' ? 60 : 300)
        if (this.availabilityState === 'online') { this.publishInfoState() }
        this.schedulePublishInfo()
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        topic = topic.split('/')
        const component = topic[topic.length - 2]
        switch(component) {
            case 'snooze':
                this.setSnoozeState(message)
                break;
            case 'snooze_minutes':
                this.setSnoozeMinutes(message)
                break;    
            case 'volume':
                this.setVolumeLevel(message)
                break;
            case 'play_ding_sound':
                this.playSound(message, 'ding')
                break;
            case 'play_motion_sound':
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
            this.publishMqtt(this.entities.snooze_minutes.stateTopic, this.entities.snooze_minutes.state.toString(), true)           
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

    async playSound(message, chimeOfType) {
        debug('Receieved play '+chimeOfType+' chime sound '+message+' for chime Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()

        switch(command) {
            case 'on':
                this.publishMqtt(this.entities[`play_${chimeOfType}_sound`].stateTopic, 'ON', true)
                await this.device.playSound(chimeOfType)
                await utils.sleep(5)
                this.publishMqtt(this.entities[`play_${chimeOfType}_sound`].stateTopic, 'OFF', true)
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