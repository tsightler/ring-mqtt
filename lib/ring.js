const { RingApi, RingDeviceType, RingCamera, RingChime } = require('@tsightler/ring-client-api')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils.js')
const rss = require('./rtsp-simple-server.js')
const BaseStation = require('../devices/base-station')
const Beam = require('../devices/beam')
const BeamOutdoorPlug = require('../devices/beam-outdoor-plug')
const Bridge = require('../devices/bridge')
const Camera = require('../devices/camera')
const Chime = require('../devices/chime')
const CoAlarm = require('../devices/co-alarm')
const ContactSensor = require('../devices/contact-sensor')
const Fan = require('../devices/fan')
const FloodFreezeSensor = require('../devices/flood-freeze-sensor')
const Keypad = require('../devices/keypad')
const Lock = require('../devices/lock')
const ModesPanel = require('../devices/modes-panel')
const MotionSensor = require('../devices/motion-sensor')
const MultiLevelSwitch = require('../devices/multi-level-switch')
const RangeExtender = require('../devices/range-extender')
const SecurityPanel = require('../devices/security-panel')
const Siren = require('../devices/siren')
const SmokeAlarm = require('../devices/smoke-alarm')
const SmokeCoListener = require('../devices/smoke-co-listener')
const Switch = require('../devices/switch')
const TemperatureSensor = require('../devices/temperature-sensor')
const Thermostat = require('../devices/thermostat')

class Ring {
    constructor() {
        this.locations = new Array()
        this.devices = new Array()
        this.mqttConnected = false
        this.republishCount = 6 // Republish config/state this many times after startup or HA start/restart
    }

    async init(ringAuth, config, tokenSource) {
        this.config = config
        try {
            debug(`Attempting connection to Ring API using ${tokenSource} refresh token.`)
            this.client = new RingApi(ringAuth)
            await this.client.getProfile()
        } catch(error) {
            this.client = false
            debug(colors.brightYellow(error.message))
            debug(colors.brightYellow(`Failed to establed connection to Ring API using ${tokenSource} refresh token.`))
        }
        return this.client
    }

    // Loop through each location and call publishLocation for supported/connected devices
    async processLocations(mqttClient) {
        // Update Ring location and device data
        await this.updateRingData(mqttClient)
    
        // For each location get existing alarm & camera devices
        this.locations.forEach(async location => {
            const devices = await this.devices.filter(d => d.locationId == location.locationId)
            // If location has devices publish them
            if (devices && devices.length) {
                if (location.hasHubs && !location.isSubscribed) {
                    // Location has an alarm or smart bridge so subscribe to websocket connection monitor
                    location.isSubscribed = true
                    location.onConnected.subscribe(async connected => {
                        if (connected) {
                            // Only publish if previous state was actually disconnected
                            if (!location.isConnected) {
                                location.isConnected = true
                                debug(`Websocket for location id ${location.locationId} is connected`)
                                this.publishDevices(location)
                            }
                        } else {
                            // Wait 30 seconds before setting devices offline in case disconnect is transient
                            // Keeps from creating "unknown" state for sensors if connection error is short lived
                            await utils.sleep(30)
                            if (!location.onConnected._value) {
                                location.isConnected = false
                                debug(`Websocket for location id ${location.locationId} is disconnected`)
                                this.devices.forEach(device => {
                                    if (device.locationId == location.locationId && !device.camera) {
                                        device.offline()
                                    }
                                })
                            }
                        }
                    })
                } else {
                    this.publishDevices(location)
                }
            } else {
                debug(`No devices found for location ID ${location.id}`)
            }
        })
    }

    // Update all Ring location/device data
    async updateRingData(mqttClient) {
        // Small delay makes debug output more readable
        await utils.sleep(1)

        // Get all Ring locations
        const locations = await this.client.getLocations()
        
        // Loop through each location and update stored locations/devices
        for (const location of locations) {
            let cameras = new Array()
            let chimes = new Array()
            const unsupportedDevices = new Array()

            debug(colors.green('-'.repeat(80)))
            // If new location, set custom properties and add to location list
            if (this.locations.find(l => l.locationId == location.locationId)) {
                debug(colors.white('Existing location: ')+colors.green(location.name)+colors.cyan(` (${location.id})`))
            } else {
                debug(colors.white('New location: ')+colors.green(location.name)+colors.cyan(` (${location.id})`))
                location.isSubscribed = false
                location.isConnected = false
                this.locations.push(location)
            }

            // Get all location devices and, if configured, cameras
            const devices = await location.getDevices()
            if (this.config.enable_cameras) { 
                cameras = await location.cameras
                chimes = await location.chimes
            }
            const allDevices = [...devices, ...cameras, ...chimes]

            // Add modes panel, if configured and the location supports it
            if (this.config.enable_modes && (await location.supportsLocationModeSwitching())) {
                allDevices.push({
                    deviceType: 'location.mode',
                    location: location,
                    id: location.locationId + '_mode',
                    onData: location.onLocationMode,
                    data: {
                        device_id: location.locationId + '_mode',
                        location_id: location.locationId
                    }
                })
            }

            // Update Ring devices for location
            for (const device of allDevices) {
                const deviceId = (device instanceof RingCamera || device instanceof RingChime) ? device.data.device_id : device.id
                let foundMessage = '  New device: '
                let ringDevice = this.devices.find(d => d.deviceId === deviceId && d.locationId === location.locationId)
                if (ringDevice) {
                    foundMessage = '  Existing device: '
                } else {
                    ringDevice = await this.getDevice(device, allDevices, mqttClient)
                    switch (ringDevice) {
                        case 'not-supported':
                            // Save unsupported device type
                            unsupportedDevices.push(device.deviceType)
                        case 'ignore':
                            ringDevice=false
                            break
                        default:
                            this.devices.push(ringDevice)
                    }
                }
                
                if (ringDevice) {
                    debug(colors.white(foundMessage)+colors.green(`${ringDevice.deviceData.name}`)+colors.cyan(' ('+ringDevice.deviceId+')'))
                    if (ringDevice.hasOwnProperty('childDevices')) {
                        const indent = ' '.repeat(foundMessage.length-4)
                        debug(colors.white(`${indent}│   `)+colors.gray(ringDevice.device.deviceType))
                        let keys = Object.keys(ringDevice.childDevices).length
                        Object.keys(ringDevice.childDevices).forEach(key => {
                            debug(colors.white(`${indent}${(keys > 1) ? '├─: ' : '└─: '}`)+colors.green(`${ringDevice.childDevices[key].name}`)+colors.cyan(` (${ringDevice.childDevices[key].id})`))
                            debug(colors.white(`${indent}${(keys > 1) ? '│   ' : '    '}`)+colors.gray(ringDevice.childDevices[key].deviceType))
                            keys--
                        })
                    } else {
                        const indent = ' '.repeat(foundMessage.length)
                        debug(colors.gray(`${indent}${ringDevice.device.deviceType}`))
                    }
                }
            }
            // Output any unsupported devices to debug with warning
            unsupportedDevices.forEach(deviceType => {
                debug(colors.yellow(`  Unsupported device: ${deviceType}`))
            })
        }
        debug(colors.green('-'.repeat(80)))
        debug('Ring location/device data updated, sleeping for 5 seconds.')
        await utils.sleep(2)
        const cameras = await this.devices.filter(d => d.device instanceof RingCamera)
        if (cameras.length > 0 && !rss.started) {
            await rss.start(cameras)
        }
        await utils.sleep(3)
    }


    // Return supported device
    async getDevice(device, allDevices, mqttClient) {
        const deviceInfo = {
            device: device,
            allDevices: allDevices,
            mqttClient: mqttClient,
            config: this.config
        }
        if (device instanceof RingCamera) {
            return new Camera(deviceInfo)
        } else if (device instanceof RingChime) {
            return new Chime(deviceInfo)
        } else if (/^lock($|\.)/.test(device.deviceType)) {
            return new Lock(deviceInfo)
        }
        switch (device.deviceType) {
            case RingDeviceType.ContactSensor:
            case RingDeviceType.RetrofitZone:
            case RingDeviceType.TiltSensor:
            case RingDeviceType.GlassbreakSensor:
                return new ContactSensor(deviceInfo)
            case RingDeviceType.MotionSensor:
                return new MotionSensor(deviceInfo)
            case RingDeviceType.FloodFreezeSensor:
                return new FloodFreezeSensor(deviceInfo)
            case RingDeviceType.SecurityPanel:
                return new SecurityPanel(deviceInfo)
            case RingDeviceType.SmokeAlarm:
                return new SmokeAlarm(deviceInfo)
            case RingDeviceType.CoAlarm:
                return new CoAlarm(deviceInfo)
            case RingDeviceType.SmokeCoListener:
                return new SmokeCoListener(deviceInfo)
            case RingDeviceType.BeamsMotionSensor:
            case RingDeviceType.BeamsMultiLevelSwitch:
            case RingDeviceType.BeamsTransformerSwitch:
            case RingDeviceType.BeamsLightGroupSwitch:
                return new Beam(deviceInfo)
            case RingDeviceType.BeamsDevice:
                return new BeamOutdoorPlug(deviceInfo)
            case RingDeviceType.MultiLevelSwitch:
                return (device.categoryId === 17) ? new Fan(deviceInfo) : new MultiLevelSwitch(deviceInfo)
            case RingDeviceType.Switch:
                return new Switch(deviceInfo)
            case RingDeviceType.Keypad:
                return new Keypad(deviceInfo)
            case RingDeviceType.BaseStation:
                return new BaseStation(deviceInfo)
            case RingDeviceType.RangeExtender:
                return new RangeExtender(deviceInfo)
            case RingDeviceType.RingNetAdapter:
                return new Bridge(deviceInfo)
            case RingDeviceType.Sensor:
                return newDevice = (device.name.toLowerCase().includes('motion'))
                    ? new MotionSensor(deviceInfo)
                    : new ContactSensor(deviceInfo)
            case 'location.mode':
                return new ModesPanel(deviceInfo)
            case 'siren':
            case 'siren.outdoor-strobe':
                return new Siren(deviceInfo)
            case RingDeviceType.Thermostat:
                return new Thermostat(deviceInfo)
            case RingDeviceType.TemperatureSensor:
                // If this is a thermostat component, ignore this device
                if (allDevices.find(d => d.id === device.data.parentZid && d.deviceType === RingDeviceType.Thermostat)) {
                    return 'ignore'
                } else {
                    return new TemperatureSensor(deviceInfo)
                }
            case RingDeviceType.BeamsSwitch:
            case 'thermostat-operating-status':
            case 'access-code':
            case 'access-code.vault':
            case 'adapter.sidewalk':
            case 'adapter.zigbee':
            case 'adapter.zwave':
                return "ignore"
        }
        return "not-supported"
    }

    // Publish devices/cameras for given location
    async publishDevices(location) {
        this.republishCount = (this.republishCount < 1) ? 1 : this.republishCount
        while (this.republishCount > 0 && this.mqttConnected) {
            try {
                const devices = await this.devices.filter(d => d.locationId == location.locationId)
                if (devices && devices.length) {
                    devices.forEach(device => {
                        // Provide location websocket connection state to device
                        device.publish(location.onConnected._value)
                    })
                }
            } catch (error) {
                debug(error)
            }
            await utils.sleep(30)
            this.republishCount--
        }
    }

    async republishDevices(mqttClient) {
        // Republish devices and state if restart of HA is detected
        if (this.republishCount > 0) {
            debug('Home Assisntat restart detected during existing republish cycle')
            debug('Resetting device config/state republish count')
            this.republishCount = 6
        } else {
            debug('Home Assistant restart detected, resending device config/state in 5 seconds')
            await utils.sleep(5)
            this.republishCount = 6
            this.processLocations(mqttClient)
        }
    }

    async processDeviceCommand(topic, message) {
        // Parse topic to get location/device ID
        const ringTopicLevels = (this.config.ring_topic).split('/').length
        const splitTopic = topic.split('/')
        const locationId = splitTopic[ringTopicLevels]
        const deviceId = splitTopic[ringTopicLevels + 2]

        // Find existing device by matching location & device ID
        const cmdDevice = this.devices.find(d => (d.deviceId == deviceId && d.locationId == locationId))

        if (cmdDevice) {
            const componentCommand = topic.split("/").slice(-2).join("/")
            cmdDevice.processCommand(message, componentCommand)
        } else {
            debug(`Received MQTT message for device Id ${deviceId} at location Id ${locationId} but could not find matching device`)
        }
    }

    async rssShutdown() {
        await rss.shutdown()
    }

    async updateMqttState(state) {
        this.mqttConnected = state
    } 
}

module.exports = new Ring()