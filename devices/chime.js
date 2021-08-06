const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const clientApi = require('../node_modules/ring-client-api/lib/api/rest-client').clientApi
const RingDevice = require('./base-ring-device')

class Chime extends RingDevice {
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
                state: null,
                min: 0,
                max: 11,
                icon: 'hass:volume-high'
            },
            snooze: {
                type: 'switch',
                state: null
            },
            snooze_duration: {
                type: 'number',
                state: 1440,
                min: 1,
                max: 1440,
                icon: "hass:timer"
            },
            wireless: {
                type: 'sensor',
                attribute: 'info',
                deviceClass: 'signal_strength',
                unitOfMeasurement: 'dBm',
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

            // Mark device as subscribed
            this.subscribed = true
        }
    }

    async publishData(isPublish) {
        const volumeState = this.device.data.settings.volume
        const snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'

        // Publish sensor state
        if (isPublish || volumeState !== this.entities.volume.state) { 
            this.publishMqtt(this.entities.volume.stateTopic, volumeState.toString(), true)
            this.entities.volume.state = volumeState
        }
        if (isPublish || snoozeState !== this.entities.snooze.state ) { 
            this.publishMqtt(this.entities.snooze.stateTopic, snoozeState, true)
            this.entities.snooze.state = snoozeState
        }
        if (isPublish || !this.subscribed) {
            this.publishMqtt(this.entities.snooze_duration.stateTopic, this.entities.snooze_duration.state.toString(), true)
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
            case 'snooze_duration':
                this.setSnoozeDuration(message)
                break;    
            case 'volume':
                this.setVolumeLevel(message)
                break;
            default:
                debug('Somehow received message to unknown state topic for camera '+this.deviceId)
        }
    }

    async setSnoozeState(message) {
        debug('Received set snooze '+message+' for chime Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        const command = message.toLowerCase()

        switch(command) {
            case 'on':
                await this.device.snooze(this.entities.snooze_duration.state)
                break;
            case 'off': {
                await this.device.clearSnooze()
                break;
            }
            default:
                debug('Received invalid command for switch!')
        }
        this.device.requestUpdate()
    }

    setSnoozeDuration(message) {
        const duration = message
        debug('Received set snooze duration to '+duration+' minutes for chime Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(duration)) {
                debug('Snooze duration command received but value is not a number')
        } else if (!(duration >= 0 && duration <= 32767)) {
            debug('Snooze duration command received but out of range (0-1440 minutes)')
        } else {
            this.entities.snooze_duration.state = parseInt(duration)
            this.publishMqtt(this.entities.snooze_duration.stateTopic, this.entities.snooze_duration.state.toString(), true)           
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