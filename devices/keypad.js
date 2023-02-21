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
                icon: 'hass:volume-high'
            },
            motion: {
                component: 'binary_sensor',
                device_class: 'motion',
                attributes: true
            }
        }

        // Ugly, but this listens to the raw data updates for all devices and
        // picks out proximity detection events for this keypad.
        this.device.location.onDataUpdate.subscribe((message) => {
            if (message.datatype === 'DeviceInfoDocType' && 
                Boolean(message.body) && 
                Array.isArray(message.body) &&
                message.body[0]?.general?.v2?.zid === this.deviceId &&
                message.body[0]?.impulse?.v1 &&
                Boolean(message.body[0].impulse.v1) &&
                Array.isArray(message.body[0].impulse.v1)
            ) {
                if (message.body[0].impulse.v1[0].impulseType === 'keypad.motion') {
                    this.processMotion()
                }
            }
        })
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false
        if (isPublish) {
            // Eventually remove this but for now this attempts to delete the old light component based volume control from Home Assistant
            this.mqttPublish(`homeassistant/light/${this.locationId}/${this.deviceId}_audio/config`, '', false)
        }

        const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(100 * this.device.data.volume) : 0)
        this.mqttPublish(this.entity.volume.state_topic, currentVolume.toString())
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
            clearTimeout(this.motion.ding.timeout)
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
