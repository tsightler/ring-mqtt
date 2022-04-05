const { RingApi, RingDeviceType, RingCamera, RingChime } = require('ring-client-api')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils')
const rss = require('./rtsp-simple-server')
const streamWorkers = require('./stream-workers')
const BaseStation = require('../devices/base-station')
const Beam = require('../devices/beam')
const BeamOutdoorPlug = require('../devices/beam-outdoor-plug')
const BinarySensor = require('../devices/binary-sensor')
const Bridge = require('../devices/bridge')
const Camera = require('../devices/camera')
const Chime = require('../devices/chime')
const CoAlarm = require('../devices/co-alarm')
const Fan = require('../devices/fan')
const FloodFreezeSensor = require('../devices/flood-freeze-sensor')
const Keypad = require('../devices/keypad')
const Lock = require('../devices/lock')
const ModesPanel = require('../devices/modes-panel')
const MultiLevelSwitch = require('../devices/multi-level-switch')
const RangeExtender = require('../devices/range-extender')
const SecurityPanel = require('../devices/security-panel')
const Siren = require('../devices/siren')
const SmokeAlarm = require('../devices/smoke-alarm')
const SmokeCoListener = require('../devices/smoke-co-listener')
const Switch = require('../devices/switch')
const TemperatureSensor = require('../devices/temperature-sensor')
const Thermostat = require('../devices/thermostat')

class RingMqtt {
    constructor() {
        this.locations = new Array()
        this.devices = new Array()
        this.mqttConnected = false
        this.republishCount = 6 // Republish config/state this many times after startup or HA start/restart

        // Configure event listeners
        utils.event.on('mqtt_state', (state) => {
            if (state === 'connected') {
                this.mqttConnected = true
                debug('MQTT connection established, processing Ring locations...')
                this.processLocations()
            } else {
                this.mqttConnected = false
            }
        })

        utils.event.on('ha_status', async (topic, message) => {
            debug('Home Assistant state topic '+topic+' received message: '+message)
            if (message === 'online') {
                // Republish devices and state if restart of HA is detected
                if (this.republishCount > 0) {
                    debug('Home Assistant restart detected during existing republish cycle')
                    debug('Resetting device config/state republish count')
                    this.republishCount = 6
                } else {
                    debug('Home Assistant restart detected, resending device config/state in 15 seconds')
                    await utils.sleep(15)
                    this.republishCount = 6
                    this.processLocations()
                }
            }
        })
    }

    async init(state, generatedToken) {
        const ringAuth = {
            refreshToken: generatedToken ? generatedToken : state.data.ring_token,
            systemId: state.data.systemId,
            controlCenterDisplayName: (process.env.RUNMODE === 'addon') ? 'ring-mqtt-addon' : 'ring-mqtt',
            ...utils.config.enable_cameras ? { cameraStatusPollingSeconds: 20, cameraDingsPollingSeconds: 2 } : {},
            ...utils.config.enable_modes ? { locationModePollingSeconds: 20 } : {},
            ...!(utils.config.location_ids === undefined || utils.config.location_ids == 0) ? { locationIds: utils.config.location_ids } : {}
        }

        try {
            debug(`Attempting connection to Ring API using ${generatedToken ? 'generated' : 'saved'} refresh token...`)
            this.client = new RingApi(ringAuth)
            await this.client.getProfile()
            utils.event.emit('ring_state', 'connected')
            debug(`Successfully established connection to Ring API using ${generatedToken ? 'generated' : 'saved'} token`)

            // Subscribe to token update events and save new tokens to state file
            this.client.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
                state.updateToken(newRefreshToken, oldRefreshToken)
            })
        } catch(error) {
            this.client = false
            debug(colors.brightYellow(error.message))
            debug(colors.brightYellow(`Failed to establish connection to Ring API using ${generatedToken ? 'generated' : 'saved'} refresh token`))
        }
        return this.client
    }

    // Loop through each location and call publishLocation for supported/connected devices
    async processLocations() {
        // Update Ring location and device data
        await this.updateRingData()
    
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
    async updateRingData() {
        // Small delay here makes debug output more readable
        await utils.sleep(1)

        // Get all Ring locations
        const locations = await this.client.getLocations()

        debug(colors.green('-'.repeat(90)))
        debug(colors.white('This account has access to the following locations:'))
        locations.map(function(location) {
            debug('           '+colors.green(location.name)+colors.cyan(` (${location.id})`))
        })
        debug(colors.green(' '.repeat(90)))
        debug(colors.brightYellow('IMPORTANT: ')+colors.white('All alarm and smart lighting hubs at these locations *MUST* be online  '))
        debug(colors.white('           or device discovery for that location will hang indefinitely!          '))
        debug(colors.white('           If desired, use the "location_ids" config option to restrict discovery '))
        debug(colors.white('           to specific locations. Please see the documentation for more details.  '))

        // Loop through each location and update stored locations/devices
        for (const location of locations) {
            let cameras = new Array()
            let chimes = new Array()
            const unsupportedDevices = new Array()

            debug(colors.green('-'.repeat(90)))
            // If new location, set custom properties and add to location list
            if (this.locations.find(l => l.locationId == location.locationId)) {
                debug(colors.white('Existing location: ')+colors.green(location.name)+colors.cyan(` (${location.id})`))
            } else {
                debug(colors.white('New location: ')+colors.green(location.name)+colors.cyan(` (${location.id})`))
                location.isSubscribed = false
                location.isConnected = false
                this.locations.push(location)
            }

            // Get all location devices and, if camera support is enabled, cameras and chimes
            const devices = await location.getDevices()
            if (utils.config.enable_cameras) { 
                cameras = await location.cameras
                chimes = await location.chimes
            }
            const allDevices = [...devices, ...cameras, ...chimes]

            // Add modes panel, if configured and the location supports it
            if (utils.config.enable_modes && (await location.supportsLocationModeSwitching())) {
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
                    ringDevice = await this.getDevice(device, allDevices)
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
        debug(colors.green('-'.repeat(90)))
        debug('Ring location/device data updated, sleeping for 5 seconds.')
        await utils.sleep(2)
        const cameras = await this.devices.filter(d => d.device instanceof RingCamera)
        if (cameras.length > 0 && !rss.started) {
            await streamWorkers.init()
            await utils.sleep(1)
            await rss.init(cameras)
        }
        await utils.sleep(3)
    }


    // Return supported device
    async getDevice(device, allDevices) {
        const deviceInfo = {
            device: device,
            ...allDevices.filter(d => d.data.parentZid === device.id).length
                ? { childDevices: allDevices.filter(d => d.data.parentZid === device.id) } : {},
            ...(device.data && device.data.hasOwnProperty('parentZid'))
                ? { parentDevice: allDevices.find(d => d.id === device.data.parentZid) } : {}
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
            case RingDeviceType.MotionSensor:
            case RingDeviceType.Sensor:
                return new BinarySensor(deviceInfo)
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
            case 'location.mode':
                return new ModesPanel(deviceInfo)
            case 'siren':
            case 'siren.outdoor-strobe':
                return new Siren(deviceInfo)
            case RingDeviceType.Thermostat:
                return new Thermostat(deviceInfo)
            case RingDeviceType.TemperatureSensor:
                // Ignore if sensor is component device of a thermostat
                if (deviceInfo.hasOwnProperty('parentDevice') && deviceInfo.parentDevice.deviceType === RingDeviceType.Thermostat) {
                    return 'ignore'
                } else {
                    return new TemperatureSensor(deviceInfo)
                }
            case RingDeviceType.BeamsSwitch:
            case 'access-code':
            case 'access-code.vault':
            case 'adapter.sidewalk':
            case 'adapter.zigbee':
            case 'adapter.zwave':
            case 'thermostat-operating-status':
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

    async rssShutdown() {
        await rss.shutdown()
    }
}

module.exports = new RingMqtt()