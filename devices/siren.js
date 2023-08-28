import RingSocketDevice from './base-socket-device.js'

export default class Siren extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = (this.device.data.deviceType === 'siren.outdoor-strobe') ? 'Outdoor Siren' : 'Siren'
        this.entity = {
            ...this.entity,
            siren: {
                component: 'switch',
                icon: 'mdi:alarm-light',
                isMainEntity: true
            },
            ...(this.device.data.deviceType === 'siren.outdoor-strobe') ? {
                volume: {
                    component: 'number',
                    min: 0,
                    max: 4,
                    mode: 'slider',
                    icon: 'hass:volume-high'
                }
            } : {}
        }
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false
        if (isPublish) {
            // Eventually remove this but for now this attempts to delete the old siren binary_sensor
            this.mqttPublish('homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'_siren/config', '', false)
        }

        const sirenState = this.device.data.sirenStatus === 'active' ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.siren.state_topic, sirenState)
        if (this.entity.hasOwnProperty('volume')) {
            const currentVolume = (this.device.data.volume && !isNaN(this.device.data.volume) ? Math.round(1 * this.device.data.volume) : 0)
            this.mqttPublish(this.entity.volume.state_topic, currentVolume)
        }
        this.publishAttributes()
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'siren/command':
                this.setSirenState(message)
                break;
            case 'volume/command':
                if (this.entity.hasOwnProperty('volume')) {
                    this.setVolumeLevel(message)
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    setSirenState(message) {
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off':
                this.debug(`Received set siren state ${message}`)
                if (this.device.data.deviceType === 'siren.outdoor-strobe') {
                    this.device.sendCommand((command ==='on') ? 'siren-test.start' : 'siren-test.stop')
                } else {
                    this.device.setInfo({ device: { v1: { on: (command === 'on') ? true : false } } })
                }
                break;
            default:
                this.debug('Received invalid siren state command')
        }
    }

    // Set volume level on received MQTT command message
    setVolumeLevel(message) {
        const volume = message / 1
        this.debug(`Received set volume level to ${volume}`)
        if (isNaN(message)) {
            this.debug('Volume command received but value is not a number')
        } else if (!(message >= 0 && message <= 4)) {
            this.debug('Volume command received but out of range (0-4)')
        } else {
            this.device.setInfo({ device: { v1: { volume } } })
        }
    }
}
