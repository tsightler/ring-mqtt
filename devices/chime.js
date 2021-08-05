const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const clientApi = require('../node_modules/ring-client-api/lib/api/rest-client').clientApi
const BaseDevice = require('./ring-base-device')

class Chime extends BaseDevice {
    constructor(deviceInfo) {
        super()

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
        console.log(deviceHealth)
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