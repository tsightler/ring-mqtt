const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

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

        // Set default device data for Home Assistant device registry
        // Values may be overridden by individual devices
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: 'Ring',
            mdl: this.device.deviceType
        }
        
        // Set device location and top level MQTT topics 
        this.deviceTopic = this.config.ring_topic+'/'+this.locationId+'/chime/'+this.deviceId
        this.availabilityTopic = this.deviceTopic+'/status'
        
        // Create info device topics
        this.stateTopic_info = this.deviceTopic+'/info/state'
        this.configTopic_info = 'homeassistant/sensor/'+this.locationId+'/'+this.deviceId+'_info/config'
        debug(this)
    }

    // Publish device state data and subscribe to
    // device data events and command topics as needed
    async publish(locationConnected) {
        if (locationConnected) {
            // Publish discovery message
            if (!this.discoveryData.length) { await this.initDiscoveryData() }
            await this.publishDiscoveryData()
            await this.online()

            if (this.subscribed) {
                this.publishData()
            } else {
                // Subscribe to data updates for device
                this.device.onData.subscribe(() => { this.publishData() })
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
    }

    initDiscoveryData() {
        // Chime Volume Level
        this.topic.volume.state = this.deviceTopic+'/volume/state'
        this.topic.volume.command = this.deviceTopic+'/volume/command'
        this.topic.volume.config = 'homeassistant/number/'+this.locationId+'/'+this.deviceId+'_volume/config'
        this.discoveryData.push({
            message: {
                name: this.deviceData.name+' Volume',
                unique_id: this.deviceId+'_volume',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.topic.volume.state,
                command_topic: this.topic.volume.command,
                min: 0,
                max: 11,
                device: this.deviceData
            },
            configTopic: this.topic.volume.config
        })

        // Snooze state
        this.topic.snooze.state = this.deviceTopic+'/snooze/state'
        this.topic.snooze.command = this.deviceTopic+'/snooze/command'
        this.topic.snooze.config = 'homeassistant/binary_sensor/'+this.locationId+'/'+this.deviceId+'_snooze/config'
        this.discoveryData.push({
            message: {
                name: this.deviceData.name+' Snooze Active',
                unique_id: this.deviceId+'_snooze',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.topic.snooze.state,
                device_class: this.topic.snoooze.command,
                device: this.deviceData
            },
            configTopic: this.topic.snooze.config
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

    publishData() {
        const volumeState = this.device.data.settings.volume
        const snoozeState = Boolean(this.device.data.do_not_disturb.seconds_left) ? 'ON' : 'OFF'
        // Publish sensor state
        this.publishMqtt(this.topic.volume.state, volumeState, true)
        this.publishMqtt(this.topic.snooze.state, snoozeState, true)
    }

    // Publish state messages with debug
    publishMqtt(topic, message, isDebug) {
        if (isDebug) { debug(topic, message) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Set state topic online
    async online() {
        // Debug output only if state changed from prior published state
        // Prevents spamming debug log with availability events during republish
        const enableDebug = (this.availabilityState == 'online') ? false : true
        await utils.sleep(1)
        this.availabilityState = 'online'
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
        await utils.sleep(1)
    }

    // Set state topic offline
    offline() {
        // Debug log output only if state changed from prior published state
        // Prevents spamming debug log with online/offline events during republish
        const enableDebug = (this.availabilityState == 'offline') ? false : true
        this.availabilityState = 'offline'
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
    }
}

module.exports = Chime