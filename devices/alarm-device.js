const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

class AlarmDevice {
    constructor(device, mqttClient, ringTopic) {
        this.device = device
        this.mqttClient = mqttClient
        // Set device location and top level MQTT topics 
        this.locationId = this.device.location.locationId
        this.deviceId = this.device.id
        this.ringTopic = ringTopic
        this.alarmTopic = ringTopic+'/'+this.locationId+'/alarm'
        this.availabilityState = 'init'
        this.published = false
        this.discoveryData = new Array()
        this.deviceData = {
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: this.device.data.manufacturerName,
            mdl: this.device.deviceType
        }
    }

    // Return batterylevel or convert battery status to estimated level
    getBatteryLevel() {
        if (this.device.data.batteryLevel !== undefined) {
            // Return 100% if 99% reported, otherwise return reported battery level
            return (this.device.data.batteryLevel === 99) ? 100 : this.device.data.batteryLevel
        } else if (this.device.data.batteryStatus === 'full') {
            return 100
        } else if (this.device.data.batteryStatus === 'ok') {
            return 50
        } else if (this.device.data.batteryStatus === 'none') {
            return 'none'
        }
        return 0
    }

    publishDiscoveryData() {
        const debugMsg = this.published ? 'Republishing existing ' : 'Publishing new '
        debug(debugMsg+'device id: '+this.deviceId)
        this.discoveryData.forEach(dd => {
            debug('HASS config topic: '+dd.configTopic)
            debug(dd.message)
            this.publishMqtt(dd.configTopic, JSON.stringify(dd.message))
        })
        this.published = true
    }

    // Publish state messages with debug
    publishMqtt(topic, message, isDebug) {
        if (isDebug) { debug(topic, message) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Publish device state data and subscribe to
    // device events if not previously subscribed
    publishSubscribeDevice() {
        if (this.subscribed) {
            this.publishData()
        } else {
            this.device.onData.subscribe(() => {
                this.publishData()
            })
            this.subscribed = true
        }
        // Publish availability state for device
        this.online()
    }

    // Publish device attributes
    publishAttributes() {
        const attributes = {}
        const batteryLevel = this.getBatteryLevel()
        if (batteryLevel !== 'none') {
            attributes.battery_level = batteryLevel
        }
        if (this.device.data.tamperStatus) {
            attributes.tamper_status = this.device.data.tamperStatus
        }
        this.publishMqtt(this.attributesTopic, JSON.stringify(attributes), true)
    }

    // Set state topic online
    async online() {
        // Debug output only if state changed from prior published state
        // Prevents spamming debug log with availability events during republish
        const enableDebug = (this.availabilityState == 'online') ? false : true
        await utils.sleep(1)
        this.availabilityState = 'online'
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
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

module.exports = AlarmDevice
