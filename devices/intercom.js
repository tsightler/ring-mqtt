import RingPolledDevice from './base-polled-device.js'

export default class Lock extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'intercom')
        this.deviceData.mdl = 'Intercom'

        this.data = {
            lock: {
                state: 'LOCKED',
                publishedState: null,
                unlockTimeout: false
            },
            ding: {
                state: 'OFF',
                publishedState: null,
                timeout: false
            }
        }

        this.entity = {
            ...this.entity,
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

        this.device.onUnlocked.subscribe(() => {
            this.setDoorUnlocked()
        })

        this.device.onDing.subscribe(() => {
            this.processDing()
        })
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
        const deviceHealth = await this.getHealth()
        if (deviceHealth && !(deviceHealth?.network_connection && deviceHealth.network_connection === 'ethernet')) {
            this.entity.wireless = {
                component: 'sensor',
                device_class: 'signal_strength',
                unit_of_measurement: 'dBm',
                parent_state_topic: 'info/state',
                attributes: 'wireless',
                value_template: '{{ value_json["wirelessSignal"] | default("") }}'
            }
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

        this.publishDingState(isPublish)
        this.publishLockState(isPublish)

        if (isPublish) {
            this.publishAttributes()
        }
    }

    publishDingState(isPublish) {
        if (this.data.ding.state !== this.data.ding.publishedState || isPublish) {
            this.mqttPublish(this.entity.ding.state_topic, this.data.ding.state)
            this.data.ding.publishedState = this.data.ding.state
        }
    }

    publishLockState(isPublish) {
        if (this.data.lock.state !== this.data.lock.publishedState || isPublish) {
            this.mqttPublish(this.entity.lock.state_topic, this.data.lock.state)
            this.data.lock.publishedState = this.data.lock.state
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        try {
            const deviceHealth = await this.getHealth()
            const attributes = {
                ...this.device?.batteryLevel
                    ? { batteryLevel: this.device.batteryLevel } : {},
                firmwareStatus: deviceHealth.firmware,
                lastUpdate: deviceHealth.updated_at.slice(0,-6)+"Z",
                wirelessNetwork: deviceHealth.wifi_name,
                wirelessSignal: deviceHealth.latest_signal_strength
            }
            this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
            this.publishAttributeEntities(attributes)
        } catch(error) {
            this.debug('Could not publish attributes due to no health data')
        }
    }

    processDing() {
        if (this.data.ding.timeout) {
            clearTimeout(this.data.ding.timeout)
            this.data.ding.timeout = false
        }
        this.data.ding.state = 'ON'
        this.publishDingState()
        this.data.ding.timeout = setTimeout(() => {
            this.data.ding.state = 'OFF'
            this.publishDingState()
            this.data.ding.timeout = false
        }, 20000)
    }

    setDoorUnlocked() {
        if (this.data.lock.unlockTimeout) {
            clearTimeout(this.data.lock.unlockTimeout)
            this.data.lock.unlockTimeout = false
        }
        this.data.lock.state = 'UNLOCKED'
        this.publishLockState()
        this.data.lock.unlockTimeout = setTimeout(() => {
            this.data.lock.state = 'LOCKED'
            this.publishLockState()
            this.data.lock.unlockTimeout = false
        }, 5000)
    }

    async getHealth() {
        try {
            const response = await this.device.restClient.request({
                url: this.device.doorbotUrl('health')
            })

            if (response.hasOwnProperty('device_health')) {
                return response.device_health
            } else {
                this.debug('Failed to parse response from device health query')
                this.debug(JSON.stringify(response))
            }
        } catch(error) {
            this.debug('Failed to retrieve health data for Intercom')
            this.debug(error)
        }
        return false
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
    async setLockState(message) {
        const command = message.toLowerCase()
        switch(command) {
            case 'lock':
                if (this.data.lock.state === 'UNLOCKED') {
                    this.debug('Received lock door command, setting locked state')
                    this.data.lock.state === 'LOCKED'
                    this.publishLockState()
                } else {
                    this.debug('Received lock door command, but door is already locked')
                }
                break;
            case 'unlock':
                this.debug('Received unlock door command, sending unlock command to intercom')
                try {
                    await this.device.unlock()
                    this.debug('Request to unlock door was successful')
                    this.setDoorUnlocked()
                } catch(error) {
                    this.debug(error)
                    this.debug('Request to unlock door failed')
                }
                break;
            default:
                this.debug('Received invalid command for lock')
        }
    }
}