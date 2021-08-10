const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingDevice = require('./base-ring-device')

// Base class for devices that communicate with hubs via websocket (alarm/smart lighting)
class RingSocketDevice extends RingDevice {
    constructor(deviceInfo) {
        super(deviceInfo, deviceInfo.device.id, deviceInfo.device.location.locationId)

        // Set default device data for Home Assistant device registry
        // Values may be overridden by individual devices
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: (this.device.data && this.device.data.manufacturerName) ? this.device.data.manufacturerName : 'Ring',
            mdl: this.device.deviceType
        }
    }

    // Publish/republish the device discovery and all state data
    async publish(locationConnected) {
        if (locationConnected) {
            await this.publishDiscovery()
            await this.online()

            if (this.subscribed) {
                this.publishData()
            } else {
                // Subscribe to data updates for device
                this.device.onData.subscribe(() => { this.publishData() })
                this.schedulePublishAttributes()
                this.subscribed = true
            }
        }
    }

    // Create device discovery data
    initAttributeEntities(deviceValue) {
        this.entities = {
            ...this.entities,
            ...this.device.data.hasOwnProperty('batteryLevel') ? { 
                battery: {
                    component: 'sensor',
                    device_class: 'battery',
                    unit_of_measurement: '%',
                    state_class: 'measurement',
                    parent_state_topic: 'info/state',
                    value_template: '{{ value_json["batteryLevel"] | default }}',
                    json_attributes_template: '{ ' +
                        '{% if my_test_json.batteryLevel is defined %}"batteryLevel": {{ my_test_json.batteryLevel }}, {% endif %} ' +
                        '{% if my_test_json.batteryLevel is defined %}"batteryStatus": "{{ my_test_json.batteryStatus }}", {% endif %} ' +
                        '{% if my_test_json.auxbatteryLevel is defined %}"auxBatteryLevel": {{ my_test_json.auxBatteryLevel }}, {% endif %} ' +
                        '{% if my_test_json.auxbatteryStatus is defined %}"auxbatteryStatus": "{{ my_test_json.auxBatteryStatus }}", {% endif %} ' +
                    '}'
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
            info: {
                component: 'sensor',
                ...deviceValue
                    ? { value_template: `{{value_json["${deviceValue}"] | default }}` }
                    : { value_template: '{{value_json["commStatus"] | default }}' }
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
                ? { batteryLevel: this.device.data.batteryLevel === 99 ? 100 : this.device.data.batteryLevel } : {},
            ... this.device.data.batteryStatus && this.device.data.batteryStatus !== 'none'
                ? { batteryStatus: this.device.data.batteryStatus } : {},
            ... (this.device.data.hasOwnProperty('auxBattery') && this.device.data.auxBattery.hasOwnProperty('level'))
                ? { auxBatteryLevel: this.device.data.auxBattery.level === 99 ? 100 : this.device.data.auxBattery.level } : {},
            ... (this.device.data.hasOwnProperty('auxBattery') && this.device.data.auxBattery.hasOwnProperty('status'))
                ? { auxBatteryStatus: this.device.data.auxBattery.status } : {},
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
        this.publishMqtt(this.entities.info.state_topic, JSON.stringify(attributes), true)
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