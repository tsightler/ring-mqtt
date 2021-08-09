const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingDevice = require('./base-ring-device')

// Base class for devices that communicate with hubs via websocket (alarm/smart lighting)
class RingSocketDevice extends RingDevice {
    constructor(deviceInfo) {
        super(deviceInfo, deviceInfo.device.id, deviceInfo.device.location.locationId)
        this.discoveryData = new Array()

        // Set default device data for Home Assistant device registry
        // Values may be overridden by individual devices
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: (this.device.data && this.device.data.manufacturerName) ? this.device.data.manufacturerName : 'Ring',
            mdl: this.device.deviceType
        }
    }

    // ***** REMOVE BEFORE RELEASE *****
    // Temporary compatibility function
    initInfoDiscoveryData(deviceValue) {
        this.initInfoEntities(deviceValue)
    }

    // Create device discovery data
    initInfoEntities(deviceValue) {
        this.entities = {
            info: {
                type: 'sensor',
                deviceClass: 'timestamp',
                ...deviceValue
                    ? { valueTemplate: `{{value_json[${deviceValue}"] | default }}` }
                    : { valueTemplate: '{{value_json["batteryLevel"] | default }}', unitOfMeasurement: '%'  }
            }
        }
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

    // Publish device state data and subscribe to
    // device data events and command topics as needed
    async publish(locationConnected) {
        // If device has custom publish function call that, otherwise
        // use common publish function
        if (typeof this.publishCustom === 'function') {
            this.publishCustom()
        } else if (locationConnected) {
            // Publish discovery message
            if (!this.discoveryData.length) { await this.initDiscoveryData() }
            await this.publishDiscoveryData()
            await this.publishDiscovery()
            await this.online()

            if (this.subscribed) {
                this.publishData()
            } else {
                // Subscribe to data updates for device
                this.device.onData.subscribe(() => { this.publishData() })
                this.schedulePublishAttributes()

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

    // Publish device info
    async publishAttributes() {
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
            ... (this.device.data.hasOwnProperty('auxBattery') && this.device.data.auxBattery.hasOwnProperty('level'))
                ? { auxBatteryLevel: this.device.data.auxBattery.level === 99 ? 100 : this.device.data.auxBattery.level }
                : {},
            ... (this.device.data.hasOwnProperty('auxBattery') && this.device.data.auxBattery.hasOwnProperty('status'))
                ? { auxBatteryStatus: this.device.data.auxBattery.status }
                : {},
            ... this.device.data.hasOwnProperty('brightness') ? { brightness: this.device.data.brightness } : {},
            ... this.device.data.chirps && this.device.deviceType == 'security-keypad' ? {chirps: this.device.data.chirps } : {},
            ... this.device.data.commStatus ? { commStatus: this.device.data.commStatus } : {},
            ... this.device.data.firmwareUpdate ? { firmwareStatus: this.device.data.firmwareUpdate.state } : {},
            ... this.device.data.lastCommTime ? { lastCommTime: utils.getISOTime(this.device.data.lastUpdate) } : {},
            ... this.device.data.lastUpdate ? { lastUpdate: utils.getISOTime(this.device.data.lastUpdate) } : {},
            ... this.device.data.linkQuality ? { linkQuality: this.device.data.linkQuality } : {},
            ... this.device.data.powerSave ? { powerSave: this.device.data.powerSave } : {},
            ... this.device.data.serialNumber ? { serialNumber: this.device.data.serialNumber } : {},
            ... this.device.data.tamperStatus ? { tamperStatus: this.device.data.tamperStatus } : {},
            ... this.device.data.hasOwnProperty('volume') ? {volume: this.device.data.volume } : {},
            ... this.device.data.hasOwnProperty('maxVolume') ? {maxVolume: this.device.data.maxVolume } : {},
        }
        this.publishMqtt(this.entities.info.stateTopic, JSON.stringify(attributes), true)
    }

    // Refresh device info attributes on a sechedule
    async schedulePublishAttributes() {
        await utils.sleep(300)
        // Only publish when site is online
        if (this.availabilityState === 'online') {
            this.publishAttributes()
        }
        this.schedulePublishAttributes()
    }
}

module.exports = RingSocketDevice
