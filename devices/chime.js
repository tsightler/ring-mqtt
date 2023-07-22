import RingPolledDevice from './base-polled-device.js'
import utils from '../lib/utils.js'

export default class Chime extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'chime')

        const savedState = this.getSavedState()

        this.data = {
            volume: null,
            snooze: null,
            snooze_minutes: savedState?.snooze_minutes ? savedState.snooze_minutes : 1440,
            snooze_minutes_remaining: Math.floor(this.device.data.do_not_disturb.seconds_left/60),
            play_ding_sound: 'OFF',
            play_motion_sound: 'OFF',
            nightlight: {
                enabled: null,
                state: null,
                set_time: Math.floor(Date.now()/1000)
            }
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
                icon: 'hass:bell-sleep',
                attributes: true
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
            ...this.device.data.settings.night_light_settings?.hasOwnProperty('light_sensor_enabled') ? {
                nightlight_enabled: {
                    component: 'switch',
                    icon: "mdi:lightbulb-night",
                    attributes: true
                }
            } : {},
            info: {
                component: 'sensor',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default("") }}'
            }
        }

        this.updateDeviceState()
    }

    updateDeviceState() {
        const stateData = {
            snooze_minutes: this.data.snooze_minutes
        }
        this.setSavedState(stateData)
    }

    initAttributeEntities() {
        this.entity.wireless = {
            component: 'sensor',
            device_class: 'signal_strength',
            unit_of_measurement: 'dBm',
            parent_state_topic: 'info/state',
            attributes: 'wireless',
            value_template: '{{ value_json["wirelessSignal"] | default("") }}'
        }
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false

        // Publish connection status
        const connectionState = this.device.data.alerts.connection
        if( connectionState !== this.connectionState || isPublish) {
            this.mqttPublish(this.connectionTopic, connectionState)
            this.connectionState = connectionState
        }

        // Polled states are published only if value changes or it's a device publish
        const volumeState = this.device.data.settings.volume
        if (volumeState !== this.data.volume || isPublish) {
            this.mqttPublish(this.entity.volume.state_topic, volumeState.toString())
            this.data.volume = volumeState
        }

        const snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'
        if (snoozeState !== this.data.snooze || isPublish) {
            this.mqttPublish(this.entity.snooze.state_topic, snoozeState)
            this.data.snooze = snoozeState
        }

        const snoozeMinutesRemaining = Math.floor(this.device.data.do_not_disturb.seconds_left/60)
        if (snoozeMinutesRemaining !== this.data.snooze_minutes_remaining || isPublish) {
            this.mqttPublish(this.entity.snooze.json_attributes_topic, JSON.stringify({ minutes_remaining: snoozeMinutesRemaining }), 'attr')
            this.data.snooze_minutes_remaining = snoozeMinutesRemaining
        }

        if (this.entity.hasOwnProperty('nightlight_enabled')) {
            const nightlightEnabled = this.device.data.settings.night_light_settings.light_sensor_enabled ? 'ON' : 'OFF'
            const nightlightState = this.device.data.night_light_state.toUpperCase()
            if ((nightlightEnabled !== this.data.nightlight.enabled && Date.now()/1000 - this.data.nightlight.set_time > 30) || isPublish) {
                this.data.nightlight.enabled = nightlightEnabled
                this.mqttPublish(this.entity.nightlight_enabled.state_topic, this.data.nightlight.enabled)
            }

            if (nightlightState !== this.data.nightlight.state || isPublish) {
                this.data.nightlight.state = nightlightState
                const attributes = { nightlightState: this.data.nightlight.state }
                this.mqttPublish(this.entity.nightlight_enabled.json_attributes_topic, JSON.stringify(attributes), 'attr')
            }
        }

        // Local states are published only for publish/republish
        if (isPublish) {
            this.mqttPublish(this.entity.snooze_minutes.state_topic, this.data.snooze_minutes.toString())
            this.mqttPublish(this.entity.play_ding_sound.state_topic, this.data.play_ding_sound)
            this.mqttPublish(this.entity.play_motion_sound.state_topic, this.data.play_motion_sound)
            this.publishAttributes()
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        const deviceHealth = await this.device.getHealth()
        if (deviceHealth) {
            const attributes = {
                firmwareStatus: deviceHealth.firmware,
                lastUpdate: deviceHealth.updated_at.slice(0,-6)+"Z",
                wirelessNetwork: deviceHealth.wifi_name,
                wirelessSignal: deviceHealth.latest_signal_strength
            }
            this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
            this.publishAttributeEntities(attributes)
        }
    }

    async setDeviceSettings(settings) {
        const response = await this.device.restClient.request({
            method: 'PATCH',
            url: `https://api.ring.com/devices/v1/devices/${this.device.id}/settings`,
            json: settings
        })
        return response
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
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
            case 'nightlight_enabled/command':
                this.setNightlightState(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    async setSnoozeState(message) {
        this.debug(`Received set snooze ${message}`)
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
                this.debug('Received invalid command for set snooze!')
        }
        this.device.requestUpdate()
    }

    setSnoozeMinutes(message) {
        const minutes = message
        this.debug(`Received set snooze minutes to ${minutes} minutes`)
        if (isNaN(minutes)) {
            this.debug('Snooze minutes command received but value is not a number')
        } else if (!(minutes >= 0 && minutes <= 32767)) {
            this.debug('Snooze minutes command received but out of range (0-1440 minutes)')
        } else {
            this.data.snooze_minutes = parseInt(minutes)
            this.mqttPublish(this.entity.snooze_minutes.state_topic, this.data.snooze_minutes.toString())
            this.updateDeviceState()
        }
    }

    async setVolumeLevel(message) {
        const volume = message
        this.debug(`Received set volume level to ${volume}`)
        if (isNaN(message)) {
            this.debug('Volume command received but value is not a number')
        } else if (!(message >= 0 && message <= 11)) {
            this.debug('Volume command received but out of range (0-11)')
        } else {
            await this.device.setVolume(volume)
            this.device.requestUpdate()
        }
    }

    async playSound(message, chimeType) {
        this.debug(`Receieved play ${chimeType} chime sound ${message}`)
        const command = message.toLowerCase()

        switch(command) {
            case 'on':
                this.mqttPublish(this.entity[`play_${chimeType}_sound`].state_topic, 'ON')
                await this.device.playSound(chimeType)
                await utils.sleep(5)
                this.mqttPublish(this.entity[`play_${chimeType}_sound`].state_topic, 'OFF')
                break;
            case 'off': {
                break;
            }
            default:
                this.debug('Received invalid command for play chime sound!')
        }
    }

    async setNightlightState(message) {
        this.debug(`Received set nightlight enabled ${message}`)
        const command = message.toUpperCase()
        switch(command) {
            case 'ON':
            case 'OFF':
                this.data.nightlight.set_time = Math.floor(Date.now()/1000)
                await this.setDeviceSettings({
                    "night_light_settings": {
                        "light_sensor_enabled": command === 'ON' ? true : false
                    }
                })
                this.data.nightlight.enabled = command
                this.mqttPublish(this.entity.nightlight_enabled.state_topic, this.data.nightlight.enabled)
                break;
            default:
                this.debug('Received invalid command for nightlight enabled mode!')
        }
    }
}
