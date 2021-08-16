const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingDevice = require('./base-ring-device')

// Base class for devices that communicate with hubs via websocket (alarm/smart lighting)
class RingSocketDevice extends RingDevice {
    constructor(deviceInfo, primaryAttribute) {
        super(deviceInfo, deviceInfo.device.id, deviceInfo.device.location.locationId, primaryAttribute)

        // Set default device data for Home Assistant device registry
        // Values may be overridden by individual devices
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: (this.device.data && this.device.data.manufacturerName) ? this.device.data.manufacturerName : 'Ring',
            mdl: this.device.deviceType
        }

        this.device.onData.subscribe((data) => {
            if (this.isOnline()) { this.publishData(data) }
        })
    }

    // Publish device discovery, set online, and send all state data
    async publish(locationConnected) {
        if (locationConnected) {
            await this.publishDiscovery()
            await this.online()
            this.publishData()
        }
    }

    // Create device discovery data
    initAttributeEntities(primaryAttribute) {
        this.entity = {
            ...this.entity,
            info: {
                component: 'sensor',
                ...primaryAttribute
                    ? { value_template: `{{value_json["${primaryAttribute}"] | default }}` }
                    : { value_template: '{{value_json["commStatus"] | default }}' }
            },
            ...this.device.data.hasOwnProperty('batteryLevel') ? { 
                battery: {
                    component: 'sensor',
                    device_class: 'battery',
                    unit_of_measurement: '%',
                    state_class: 'measurement',
                    parent_state_topic: 'info/state',
                    attributes: 'battery',
                    value_template: '{{ value_json["batteryLevel"] | default }}'
                }
            } : {},
            ...this.device.data.hasOwnProperty('tamperStatus') ? {
                tamper: {
                    component: 'binary_sensor',
                    device_class: 'problem',
                    parent_state_topic: 'info/state',
                    value_template: '{% if value is equalto "tamper" %} ON {% else %} OFF {% endif %}'
                }
            } : {},
            ... this.device.data.hasOwnProperty('networkConnection') && this.device.data.networkConnection === 'wlan0'
                && this.device.data.hasOwnProperty('networks') && this.device.data.networks.hasOwnProperty('wlan0') ? {
                    wireless: {
                        component: 'sensor',
                        device_class: 'signal_strength',
                        unit_of_measurement: 'dBm',
                        parent_state_topic: 'info/state',
                        attributes: 'wireless',
                        value_template: '{{ value_json["wirelessSignal"] | default }}'
                    }
                } : {}
        }
    }

    // Publish device info
    async publishAttributes() {
        // Get full set of device data and publish to info topic JSON attributes
        const attributes = {
            ... this.device.data.hasOwnProperty('acStatus') ? { acStatus: this.device.data.acStatus } : {},
            ... this.device.data.hasOwnProperty('alarmInfo') && this.device.data.alarmInfo.hasOwnProperty('state')
                ? { alarmState: this.device.data.alarmInfo.state }
                : (this.device.deviceType === 'security-panel') 
                    ? { alarmState: 'all-clear' } : {},
            ... this.device.data.hasOwnProperty('batteryLevel')
                ? { batteryLevel: this.device.data.batteryLevel === 99 ? 100 : this.device.data.batteryLevel } : {},
            ... this.device.data.hasOwnProperty('batteryStatus') && this.device.data.batteryStatus !== 'none'
                ? { batteryStatus: this.device.data.batteryStatus } : {},
            ... (this.device.data.hasOwnProperty('auxBattery') && this.device.data.auxBattery.hasOwnProperty('level'))
                ? { auxBatteryLevel: this.device.data.auxBattery.level === 99 ? 100 : this.device.data.auxBattery.level } : {},
            ... (this.device.data.hasOwnProperty('auxBattery') && this.device.data.auxBattery.hasOwnProperty('status'))
                ? { auxBatteryStatus: this.device.data.auxBattery.status } : {},
            ... this.device.data.hasOwnProperty('brightness') 
                ? { brightness: this.device.data.brightness } : {},
            ... this.device.data.hasOwnProperty('chirps') && this.device.deviceType == 'security-keypad' 
                ? { chirps: this.device.data.chirps } : {},
            ... this.device.data.hasOwnProperty('commStatus') 
                ? { commStatus: this.device.data.commStatus } : {},
            ... this.device.data.hasOwnProperty('firmwareUpdate') 
                ? { firmwareStatus: this.device.data.firmwareUpdate.state } : {},
            ... this.device.data.hasOwnProperty('lastCommTime') 
                ? { lastCommTime: utils.getISOTime(this.device.data.lastUpdate) } : {},
            ... this.device.data.hasOwnProperty('lastUpdate') 
                ? { lastUpdate: utils.getISOTime(this.device.data.lastUpdate) } : {},
            ... this.device.data.hasOwnProperty('linkQuality') 
                ? { linkQuality: this.device.data.linkQuality } : {},
            ... this.device.data.hasOwnProperty('powerSave') 
                ? { powerSave: this.device.data.powerSave } : {},
            ... this.device.data.hasOwnProperty('serialNumber') 
                ? { serialNumber: this.device.data.serialNumber } : {},
            ... this.device.data.hasOwnProperty('tamperStatus') 
                ? { tamperStatus: this.device.data.tamperStatus } : {},
            ... this.device.data.hasOwnProperty('volume') 
                ? {volume: this.device.data.volume } : {},
            ... this.device.data.hasOwnProperty('maxVolume')
                ? {maxVolume: this.device.data.maxVolume } : {},
            ... this.device.data.hasOwnProperty('networkConnection') && this.device.data.networkConnection === 'wlan0'
                && this.device.data.hasOwnProperty('networks') && this.device.data.networks.hasOwnProperty('wlan0')
                    ? { wirelessNetwork: this.device.data.networks.wlan0.ssid, wirelessSignal: this.device.data.networks.wlan0.rssi } : {}
        }
        this.publishMqtt(this.entity.info.state_topic, JSON.stringify(attributes), true)
        this.publishAttributeEntities(attributes)
    }
}

module.exports = RingSocketDevice