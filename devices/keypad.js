import RingSocketDevice from './base-socket-device.js'

export default class Keypad extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Security Keypad'

        this.data = {
            motion: {
                state: 'OFF',
                publishedState: null,
                timeout: false
            }
        }

        this.entity = {
            ...this.entity,
            volume: {
                component: 'number',
                min: 0,
                max: 100,
                mode: 'slider',
                icon: 'hass:volume-high'
            },
            motion: {
                component: 'binary_sensor',
                device_class: 'motion',
                attributes: true
            },
            chirps: {
                component: 'switch',
                icon: 'mdi:bird'
            }
        }

        // Listen to raw data updates for all devices and pick out
        // proximity detection events for this keypad.
        this.device.location.onDataUpdate.subscribe((message) => {
            if (this.isOnline() &&
                message.datatype === 'DeviceInfoDocType' &&
                message.body?.[0]?.general?.v2?.zid === this.deviceId &&
                message.body[0].impulse?.v1?.[0]?.impulseType === 'keypad.motion'
            ) {
                this.processMotion()
            }
        })
    }

    publishState(data) {
        const isPublish = Boolean(data === undefined)
        if (isPublish) {
            // Eventually remove this but for now this attempts to delete the old light component based volume control from Home Assistant
            this.mqttPublish(`homeassistant/light/${this.locationId}/${this.deviceId}_audio/config`, '', false)
        }
        const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
        this.mqttPublish(this.entity.volume.state_topic, currentVolume.toString())
        this.mqttPublish(this.entity.chirps.state_topic, this.device.data?.chirps === 'enabled' ? 'ON' : 'OFF')
        this.publishMotionState(isPublish)
        this.publishAttributes()
    }

    publishMotionState(isPublish) {
        if (this.data.motion.state !== this.data.motion.publishedState || isPublish) {
            this.mqttPublish(this.entity.motion.state_topic, this.data.motion.state)
            this.data.motion.publishedState = this.data.motion.state
        }
    }

    processMotion() {
        if (this.data.motion.timeout) {
            clearTimeout(this.data.motion.timeout)
            this.data.motion.timeout = false
        }
        this.data.motion.state = 'ON'
        this.publishMotionState()
        this.data.motion.timeout = setTimeout(() => {
            this.data.motion.state = 'OFF'
            this.publishMotionState()
            this.data.motion.timeout = false
        }, 20000)
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'volume/command':
                this.setVolumeLevel(message)
                break;
            case 'chirps/command':
                this.setChirpsState(message)
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

    // Set chirps target state on received MQTT command message
    setChripsState(message) {
        this.debug(`Received set chrips state ${message}`)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off': {
                this.device.setInfo({ device: { v1: { chirps: command === 'on' ? 'enabled' : 'disabled' } } })
                break;
            }
            default:
                this.debug('Received invalid command for chirps switch!')
        }
    }

}
