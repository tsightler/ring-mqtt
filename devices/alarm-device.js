const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

class AlarmDevice {
    constructor(deviceInfo) {
        // Set default properties for alarm device object model 
        this.device = deviceInfo.device
        this.mqttClient = deviceInfo.mqttClient
        this.subscribed = false
        this.availabilityState = 'init'
        this.discoveryData = new Array()
        this.deviceId = this.device.id
        this.locationId = this.device.location.locationId
        this.config = deviceInfo.CONFIG

        // Set default device data for Home Assistant device registry
        // Values may be overridden by individual devices
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: (this.device.data && this.device.data.manufacturerName) ? this.device.data.manufacturerName : 'Ring',
            mdl: this.device.deviceType
        }
        
        // Set device location and top level MQTT topics 
        this.ringTopic = this.config.ring_topic
        this.deviceTopic = this.ringTopic+'/'+this.locationId+'/'+deviceInfo.category+'/'+this.deviceId
        this.availabilityTopic = this.deviceTopic+'/status'
        
        // Create info device topics
        this.stateTopic_info = this.deviceTopic+'/info/state'
        this.configTopic_info = 'homeassistant/sensor/'+this.locationId+'/'+this.deviceId+'_info/config'
    }

    // Return batterylevel or convert battery status to estimated level
    getBatteryLevel() {
        if (this.device.data.batteryLevel !== undefined) {
            // Return 100% if 99% reported, otherwise return reported battery level
            return (this.device.data.batteryLevel === 99) ? 100 : this.device.data.batteryLevel
        } else if (this.device.data.batteryStatus === 'full' || this.device.data.batteryStatus === 'charged') {
            return 100
        } else if (this.device.data.batteryStatus === 'ok' || this.device.data.batteryStatus === 'charging') {
            return 50
        } else if (this.device.data.batteryStatus === 'none') {
            return 'none'
        }
        return 0
    }

    // Create device discovery data
    initInfoDiscoveryData(deviceValue) {
        // If set override value tempate setting with device specific value
        const value = deviceValue
            ? { template: '{{value_json["'+deviceValue+'"]}}' }
            : { template: '{{value_json["batteryLevel"]}}', uom: '%' }

        // Init info entity (extended device data)
        this.discoveryData.push({
            message: {
                name: this.deviceData.name+' Info',
                unique_id: this.deviceId+'_info',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_info,
                json_attributes_topic: this.stateTopic_info,
                icon: "mdi:information-outline",
                ... value.template ? { value_template: value.template } : {},
                ... value.uom ? { unit_of_measurement: value.uom } : {},
                device: this.deviceData
            },
            configTopic: this.configTopic_info
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

    // Publish state messages with debug
    publishMqtt(topic, message, isDebug) {
        if (isDebug) { debug(topic, message) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Publish device state data and subscribe to
    // device data events and command topics as needed
    async publishDevice() {
        // Publish discovery message
        if (!this.discoveryData.length) { await this.initDiscoveryData() }
        await this.publishDiscoveryData()

        if (this.subscribed) {
            this.publishData()
        } else {
            // Subscribe to data updates for device
            this.device.onData.subscribe(() => { this.publishData() })

            // Subscribe to any device command topics
            const properties = Object.getOwnPropertyNames(this)
            const commandTopics = properties.filter(p => p.match(/^commandTopic.*/g))
            commandTopics.forEach(commandTopic => {
                this.mqttClient.subscribe(this[commandTopic])
            })

            // Mark device as subscribed
            this.subscribed = true
        }
        this.online()
    }

    // Publish device info
    publishAttributes() {
        let alarmState

        if (this.device.deviceType === 'security-panel') {
            alarmState = this.device.data.alarmInfo ? this.device.data.alarmInfo.state : 'all-clear'
        }

        // Get full set of device data and publish to info topic
        const attributes = {
            ... this.device.data.acStatus ? { acStatus: this.device.data.acStatus } : {},
            ... alarmState ? { alarmState: alarmState } : {},
            ... this.device.data.hasOwnProperty('batteryLevel')
                ? { batteryLevel: this.device.data.batteryLevel === 99 ? 100 : this.device.data.batteryLevel }
                : {},
            ... this.device.data.batteryStatus && this.device.data.batteryStatus !== 'none'
                ? { batteryStatus: this.device.data.batteryStatus }
                : {},
            ... this.device.data.hasOwnProperty('brightness') ? {brightness: this.device.data.brightness } : {},
            ... this.device.data.chirps && this.device.deviceType == 'security-keypad' ? {chirps: this.device.data.chirps } : {},
            ... this.device.data.commStatus ? { commStatus: this.device.data.commStatus } : {},
            ... this.device.data.firmwareUpdate ? { firmwareStatus: this.device.data.firmwareUpdate.state } : {},
            ... this.device.data.lastCommTime ? { lastCommTime: new Date(this.device.data.lastCommTime).toISOString() } : {},
            ... this.device.data.lastUpdate ? { lastUpdate: new Date(this.device.data.lastUpdate).toISOString() } : {},
            ... this.device.data.linkQuality ? { linkQuality: this.device.data.linkQuality } : {},
            ... this.device.data.powerSave ? {powerSave: this.device.data.powerSave } : {},
            ... this.device.data.serialNumber ? { serialNumber: this.device.data.serialNumber } : {},
            ... this.device.data.tamperStatus ? { tamperStatus: this.device.data.tamperStatus } : {},
            ... this.device.data.hasOwnProperty('volume') ? {volume: this.device.data.volume } : {},
        }
        this.publishMqtt(this.stateTopic_info, JSON.stringify(attributes), true)

        // If first publish schedule attributes to be resent every 5 minutes
        if (!this.attributesScheduled) { 
            this.attributesScheduled = true
            const _this = this
            setInterval(function () {
                if (_this.availabilityState = 'online') { _this.publishAttributes() }
            }, 300000)
        }
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
