import RingPolledDevice from './base-polled-device.js'
import utils from '../lib/utils.js'

export default class Lock extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'intercom')

        this.entity = {
            lock: {
                component: 'lock'
            },
            ding: {
                component: 'binary_sensor',
                attributes: true,
                icon: 'mdi:doorbell'
            },
            info: {
                component: 'sensor',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default("") }}'
            }
        }

        this.data = {
            lock: {
                state: true,
                publishedState: null
            },
            ding: {
                state: false,
                publishedState: null
            }
        }
    }

    async initAttributeEntities() {
        // If device is battery powered publish battery entity
        if (this.device.batteryLevel !== null) {
            this.entity.battery = {
                component: 'sensor',
                device_class: 'battery',
                unit_of_measurement: '%',
                state_class: 'measurement',
                parent_state_topic: 'info/state',
                attributes: 'battery',
                value_template: '{{ value_json["batteryLevel"] | default("") }}'
            }
        }
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false

        const lockState = this.data.lock.state ? 'LOCKED' : 'UNLOCKED'
        this.mqttPublish(this.entity.lock.state_topic, lockState)

        if (isPublish) {
            this.publishAttributes()
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        const attributes = {
            ... this.device.data.hasOwnProperty('batteryLevel')
                ? { batteryLevel: this.device.data.batteryLevel === 99 ? 100 : this.device.data.batteryLevel } : {},
        }
        this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
        this.publishAttributeEntities(attributes)
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'lock/command':
                this.setLockState(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set lock target state on received MQTT command message
    setLockState(message) {
        this.debug(`Received set lock state ${message}`)
        const command = message.toLowerCase()
        switch(command) {
            case 'lock':
            case 'unlock':
                this.device.sendCommand(`lock.${command}`)
                break;
            default:
                this.debug('Received invalid command for lock')
        }
    }
}