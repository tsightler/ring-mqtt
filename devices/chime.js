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

    // Publish device state data and subscribe to
    // device data events and command topics as needed
    async publish() {
        const debugMsg = (this.availabilityState === 'init') ? 'Publishing new ' : 'Republishing existing '
        debug(debugMsg+'device id: '+this.deviceId)

        // Publish discovery message
        if (!this.discoveryData.length) { await this.initDiscoveryData() }
        await this.publishDiscoveryData()
        await utils.sleep(2)
        await this.online()

        if (this.subscribed) {
            this.publishData()
        } else {
            // Subscribe to data updates for device
            this.device.onData.subscribe(() => { this.publishData(true) })
            // this.schedulePublishAttributes()

            // Subscribe to any device command topics
            const properties = Object.getOwnPropertyNames(this)
            const commandTopics = properties.filter(p => p.match(/^commandTopic.*/g))
            commandTopics.forEach(commandTopic => {
                this.mqttClient.subscribe(this[commandTopic])
            })

            // Mark device as subscribed
            this.subscribed = true
        }
    }

    publishDiscovery() {
        Object.keys(this.entities).forEach(entity => {
            const entityTopic = `${this.deviceTopic}/${entity}`
            const entityId = this.entities[entity].hasOwnProperty('id') ? this.entities[entity].id : `${this.deviceId}_${entity}`
            const deviceName = this.entities[entity].hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${this.entities[entity].suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entity.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            this.entities[entity].stateTopic = `${entityTopic}/state`
            this.entities[entity].configTopic = `homeassistant/${this.entities[entity].type}/${this.locationId}/${entityId}/config`

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
                    discoveryMessage.state_topic = this.entities[entity].stateTopic,
                    discoveryMessage.command_topic = `${entityTopic}/command`
                    break;
                case 'sensor':
                    discoveryMessage.state_topic = this.entities[entity].stateTopic
                    discoveryMessage.json_attributes_topic = this.entities[entity].stateTopic
                    discoveryMessage.icon = 'mdi:information-outline'
                    break;
                case 'number':
                    discoveryMessage.state_topic = this.entities[entity].stateTopic
                    discoveryMessage.command_topic = `${entityTopic}/command`
                    discoveryMessage.min = this.entities[entity].min
                    discoveryMessage.max = this.entities[entity].max
                    break;
            }

            if (discoveryMessage.hasOwnProperty('command_topic')) {
                this.entities[entity].commandTopic = discoveryMessage.command_topic
            }
            console.log(this.entities[entity])
            console.log(discoveryMessage)
        })
    }

    // Publish all discovery data for device
    async publishDiscoveryData() {
        const debugMsg = (this.availabilityState == 'init') ? 'Publishing new ' : 'Republishing existing '
        debug(debugMsg+'device id: '+this.deviceId)
        this.discoveryData.forEach(dd => {
            debug('HASS config topic: '+dd.configTopic)
            debug(dd.message)
            this.publishMqtt(dd.configTopic, JSON.stringify(dd.message))
        })
        // Sleep for a few seconds to give HA time to process discovery message
        await utils.sleep(2)
    }

    async publishData(isDataEvent) {
        debug(clientApi())
        const chimeHealth = await this.device.restClient.request({
            url: clientApi(`chimes/${this.device.id}/health`),
            responseType: 'json',
        })
        debug(chimeHealth)
        let volumeState = this.device.data.settings.volume
        let snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'

        if (isDataEvent) {
            volumeState = (this.entities.volume.state !== volumeState ) ? volumeState : false
            snoozeState = (this.entities.snooze.state !== snoozeState ) ? snoozeState : false
        }

        // Publish sensor state
        if (volumeState) {
            this.entities.volume.state = volumeState
            this.publishMqtt(this.entities.volume.stateTopic, volumeState.toString(), true)
        }

        if (snoozeState) { 
            this.entities.snooze.state = snoozeState
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
            this.publishMqtt(this.deviceTopic+'/info/state', JSON.stringify(attributes), true)
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