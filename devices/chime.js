const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const clientApi = require('../node_modules/ring-client-api/lib/api/rest-client').clientApi

class Chime {
    constructor(deviceInfo) {
        // Set default properties for alarm device object model 
        this.device = deviceInfo.device
        this.mqttClient = deviceInfo.mqttClient
        this.subscribed = false
        this.availabilityState = 'init'
        this.discoveryData = new Array()
        this.deviceId = this.device.data.device_id
        this.locationId = this.device.data.location_id
        this.config = deviceInfo.CONFIG
        this.heartbeat = 3

        // Set default device data for Home Assistant device registry
        // Values may be overridden by individual devices
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: 'Ring',
            mdl: this.device.deviceType.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())
        }
        
        // Set device location and top level MQTT topics 
        this.deviceTopic = this.config.ring_topic+'/'+this.locationId+'/chime/'+this.deviceId
        this.availabilityTopic = this.deviceTopic+'/status'

        this.entities = {
            volume: {
                type: 'number',
                state: this.device.data.settings.volume,
                min: 0,
                max: 11
            },
            snooze: {
                type: 'switch',
                state: Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'
            },
            info: {
                type: 'sensor'
            }
        }

        this.publishDiscovery()
    }

    // Perforsms device publish and re-publish functions (subscribed vs not subscribed)
    async publish() {
        const debugMsg = (this.availabilityState === 'init') ? 'Publishing new ' : 'Republishing existing '
        debug(debugMsg+'device id: '+this.deviceId)

        await this.publishDiscovery()
        await this.online()

        if (this.subscribed) {
            this.publishData()
            this.publishInfoState()
        } else {
            // Subscribe to data updates for device
            this.device.onData.subscribe(data => { this.publishData(data) })

            this.publishInfoState()
            this.schedulePublishInfo()

            // Mark device as subscribed
            this.subscribed = true
        }
    }

    async publishDiscovery() {
        Object.keys(this.entities).forEach(entity => {
            const entityTopic = `${this.deviceTopic}/${entity}`
            const entityId = this.entities[entity].hasOwnProperty('id') ? this.entities[entity].id : `${this.deviceId}_${entity}`
            const deviceName = this.entities[entity].hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${this.entities[entity].suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entity.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            const discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                availabilityTopic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            switch (this.entities[entity].type) {
                case 'switch':
                    discoveryMessage.state_topic = `${entityTopic}/state`
                    discoveryMessage.command_topic = `${entityTopic}/command`
                    break;
                case 'sensor':
                    discoveryMessage.state_topic = `${entityTopic}/state`
                    discoveryMessage.json_attributes_topic = `${entityTopic}/state`
                    discoveryMessage.icon = 'mdi:information-outline'
                    break;
                case 'number':
                    discoveryMessage.state_topic = `${entityTopic}/state`
                    discoveryMessage.command_topic = `${entityTopic}/command`
                    discoveryMessage.min = this.entities[entity].min
                    discoveryMessage.max = this.entities[entity].max
                    break;
            }

            // Save state/command topics to entity properties for later use
            if (!this.entities[entity].hasOwnProperty('stateTopic')) {
                this.entities[entity].stateTopic = `${entityTopic}/state`
                if (discoveryMessage.hasOwnProperty('command_topic')) {
                    this.entities[entity].commandTopic = discoveryMessage.command_topic
                    this.mqttClient.subscribe(this.entities[entity].commandTopic)
                }
            }

            const configTopic = `homeassistant/${this.entities[entity].type}/${this.locationId}/${entityId}/config`
            debug('HASS config topic: '+configTopic)
            debug(discoveryMessage)
            this.publishMqtt(configTopic, JSON.stringify(discoveryMessage))
        })
        // Sleep for a few seconds to give HA time to process discovery message
        await utils.sleep(2)
    }

    async publishData(data) {
        let volumeState = this.device.data.settings.volume
        let snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'

        // If it's a data event only published changed vaolumes
        if (data) {
            volumeState = (this.entities.volume.state !== volumeState) ? volumeState : false
            this.entities.volume.state = volumeState

            snoozeState = (this.entities.snooze.state !== snoozeState) ? snoozeState : false
            this.entities.snooze.state = snoozeState
        }

        // Publish sensor state
        if (volumeState) { 
            this.publishMqtt(this.entities.volume.stateTopic, volumeState.toString(), true)
        }
        if (snoozeState) { 
            this.publishMqtt(this.entities.snooze.stateTopic, snoozeState, true)
        }
    }

    // Publish device data to info topic
    async publishInfoState() {
        const deviceHealth = 
            await this.device.restClient.request({
                url: clientApi(`chimes/${this.device.id}/health`),
                responseType: 'json'
            }).catch()
        
        if (deviceHealth) {
            const attributes = {}
            attributes.wirelessNetwork = deviceHealth.wifi_name
            attributes.wirelessSignal = deviceHealth.latest_signal_strength
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            this.publishMqtt(this.entities.info.stateTopic, JSON.stringify(attributes), true)
        }
    }

    // Publish heath state every 5 minutes when online
    async schedulePublishInfo() {
        await utils.sleep(this.availabilityState === 'offline' ? 60 : 300)
        if (this.availabilityState === 'online') { this.publishInfoState() }
        this.schedulePublishInfo()
    }

    // Publish state messages with debug
    publishMqtt(topic, message, isDebug) {
        if (isDebug) { debug(topic, message) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Publish availability state
    publishAvailabilityState(enableDebug) {
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
    }

    // Set state topic online
    async online() {
        const enableDebug = (this.availabilityState == 'online') ? false : true
        await utils.sleep(1)
        this.availabilityState = 'online'
        this.publishAvailabilityState(enableDebug)
        await utils.sleep(1)
    }

    // Set state topic offline
    offline() {
        const enableDebug = (this.availabilityState == 'offline') ? false : true
        this.availabilityState = 'offline'
        this.publishAvailabilityState(enableDebug)
    }
}

module.exports = Chime