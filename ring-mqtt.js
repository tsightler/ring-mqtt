#!/usr/bin/env node

// Defines
const { RingApi, RingDeviceType, RingCamera, RingChime } = require('ring-client-api')
const mqttApi = require ('mqtt')
const isOnline = require ('is-online')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./lib/utils.js')
const tokenApp = require('./lib/tokenapp.js')
const rss = require('./lib/rtsp-simple-server.js')
const { createHash, randomBytes } = require('crypto')
const fs = require('fs')
const SecurityPanel = require('./devices/security-panel')
const ContactSensor = require('./devices/contact-sensor')
const MotionSensor = require('./devices/motion-sensor')
const FloodFreezeSensor = require('./devices/flood-freeze-sensor')
const SmokeCoListener = require('./devices/smoke-co-listener')
const SmokeAlarm = require('./devices/smoke-alarm')
const CoAlarm = require('./devices/co-alarm')
const Lock = require('./devices/lock')
const Switch = require('./devices/switch')
const MultiLevelSwitch = require('./devices/multi-level-switch')
const Fan = require('./devices/fan')
const Beam = require('./devices/beam')
const Camera = require('./devices/camera')
const Chime = require('./devices/chime')
const ModesPanel = require('./devices/modes-panel')
const Keypad = require('./devices/keypad')
const BaseStation = require('./devices/base-station')
const RangeExtender = require('./devices/range-extender')
const Bridge = require('./devices/bridge')
const Siren = require('./devices/siren')
const Thermostat = require('./devices/thermostat')
const TemperatureSensor = require('./devices/temperature-sensor')

var CONFIG
var ringLocations = new Array()
var ringDevices = new Array()
var mqttConnected = false
var republishCount = 6 // Republish config/state this many times after startup or HA start/restart
var republishDelay = 30 // Seconds

// Setup Exit Handwlers
process.on('exit', processExit.bind(null, 0))
process.on('SIGINT', processExit.bind(null, 0))
process.on('SIGTERM', processExit.bind(null, 0))
process.on('uncaughtException', function(err) {
    debug(colors.red('ERROR - Uncaught Exception'))
    console.log(colors.red(err))
    processExit(2)
})
process.on('unhandledRejection', function(err) {
    switch(true) {
        // For these strings suppress the stack trace and only print the message
        case /token is not valid/.test(err.message):
        case /https:\/\/github.com\/dgreif\/ring\/wiki\/Refresh-Tokens/.test(err.message):
        case /error: access_denied/.test(err.message):
            debug(colors.yellow(err.message))
            break;
        default:
            debug(colors.yellow('WARNING - Unhandled Promise Rejection'))
            console.log(colors.yellow(err))
            break;
    }
})

// Set offline status on exit
async function processExit(exitCode) {
    await utils.sleep(1)
    debug('The ring-mqtt process is shutting down...')
    rss.shutdown()
    if (ringDevices.length > 0) {
        debug('Setting all devices offline...')
        await utils.sleep(1)
        ringDevices.forEach(ringDevice => {
            if (ringDevice.availabilityState === 'online') { 
                ringDevice.shutdown = true
                ringDevice.offline() 
            }
        })
    }
    await utils.sleep(2)
    if (exitCode || exitCode === 0) debug(`Exit code: ${exitCode}`);
    process.exit()
}

// Return supported device
async function getDevice(device, mqttClient, allDevices) {
    const deviceInfo = {
        device: device,
        category: 'alarm',
        mqttClient: mqttClient,
        CONFIG
    }
    if (device instanceof RingCamera) {
        deviceInfo.category = 'camera'
        return new Camera(deviceInfo)
    } else if (device instanceof RingChime) {
        deviceInfo.category = 'chime'
        return new Chime(deviceInfo)
    } else if (/^lock($|\.)/.test(device.deviceType)) {
        return new Lock(deviceInfo)
    }
    switch (device.deviceType) {
        case RingDeviceType.ContactSensor:
        case RingDeviceType.RetrofitZone:
        case RingDeviceType.TiltSensor:
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
            // If this is a child device pass in parent device as well
            const parentDevice = allDevices.find(d => d.id === device.data.parentZid && d.deviceType === RingDeviceType.SmokeAlarm)
            return new CoAlarm(deviceInfo, parentDevice)
        case RingDeviceType.SmokeCoListener:
            return new SmokeCoListener(deviceInfo)
        case RingDeviceType.BeamsMotionSensor:
        case RingDeviceType.BeamsMultiLevelSwitch:
        case RingDeviceType.BeamsTransformerSwitch:
        case RingDeviceType.BeamsLightGroupSwitch:
            deviceInfo.category = 'lighting'
            return new Beam(deviceInfo)
        case RingDeviceType.MultiLevelSwitch:
            return newDevice = (device.categoryId === 17)
                ? new Fan(deviceInfo)
                : new MultiLevelSwitch(deviceInfo)
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
        case 'siren.outdoor-strobe':
            return new Siren(deviceInfo)
        case RingDeviceType.Thermostat:
            const operatingStatus = allDevices.find(d => d.data.parentZid === device.id && d.deviceType === 'thermostat-operating-status')
            const temperatureSensor = allDevices.find(d => d.data.parentZid === device.id && d.deviceType === RingDeviceType.TemperatureSensor)
            if (operatingStatus && temperatureSensor) {
                return new Thermostat(deviceInfo, operatingStatus, temperatureSensor)
            }
        case RingDeviceType.TemperatureSensor:
            // If this is a thermostat component, ignore this device
            if (allDevices.find(d => d.id === device.data.parentZid && d.deviceType === RingDeviceType.Thermostat)) {
                return 'ignore'
            } else {
                return new TemperatureSensor(deviceInfo)
            }
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

// Update all Ring location/device data
async function updateRingData(mqttClient, ringClient) {
    // Small delay makes debug output more readable
    await utils.sleep(1)

    // Get all Ring locations
    const locations = await ringClient.getLocations()
    
    // Loop through each location and update stored locations/devices
    for (const location of locations) {
        let cameras = new Array()
        let chimes = new Array()
        const unsupportedDevices = new Array()

        debug(colors.green('-'.repeat(80)))
        // If new location, set custom properties and add to location list
        if (ringLocations.find(l => l.locationId == location.locationId)) {
            debug(colors.white('Existing location: ')+colors.green(location.name)+colors.cyan(` (${location.id})`))
        } else {
            debug(colors.white('New location: ')+colors.green(location.name)+colors.cyan(` (${location.id})`))
            location.isSubscribed = false
            location.isConnected = false
            ringLocations.push(location)
        }

        // Get all location devices and, if configured, cameras
        const devices = await location.getDevices()
        if (CONFIG.enable_cameras) { 
            cameras = await location.cameras
            chimes = await location.chimes
        }
        const allDevices = [...devices, ...cameras, ...chimes]

        // Add modes panel, if configured and the location supports it
        if (CONFIG.enable_modes && (await location.supportsLocationModeSwitching())) {
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
            let ringDevice = ringDevices.find(d => d.deviceId === deviceId && d.locationId === location.locationId)
            if (ringDevice) {
                foundMessage = '  Existing device: '
            } else {
                ringDevice = await getDevice(device, mqttClient, allDevices)
                switch (ringDevice) {
                    case 'not-supported':
                        // Save unsupported device type
                        unsupportedDevices.push(device.deviceType)
                    case 'ignore':
                        ringDevice=false
                        break
                    default:
                        ringDevices.push(ringDevice)
                }
            }
            
            if (ringDevice) {
                debug(colors.white(foundMessage)+colors.green(`${ringDevice.deviceData.name}`)+colors.cyan(' ('+ringDevice.deviceId+')'))
                if (ringDevice.device.deviceType === RingDeviceType.Thermostat) {
                    const spacing = ' '.repeat(foundMessage.length-4)
                    debug(colors.white(`${spacing}│   `)+colors.gray(ringDevice.device.deviceType))
                    debug(colors.white(`${spacing}├─: `)+colors.green('Operating Status')+colors.cyan(` (${ringDevice.operatingStatus.id})`))
                    debug(colors.white(`${spacing}│   `)+colors.gray(ringDevice.operatingStatus.deviceType))
                    debug(colors.white(`${spacing}└─: `)+colors.green('Temperature Sensor')+colors.cyan(` (${ringDevice.temperatureSensor.id})`))
                    debug(colors.gray(`${spacing}    `+ringDevice.temperatureSensor.deviceType))
                } else {
                    const spacing = ' '.repeat(foundMessage.length)
                    debug(colors.gray(`${spacing}${ringDevice.device.deviceType}`))
                }
            }
        }
        // Output any unsupported devices to debug with warning
        unsupportedDevices.forEach(deviceType => {
            debug(colors.yellow('  Unsupported device: '+deviceType))
        })
    }
    debug(colors.green('-'.repeat(80)))
    debug('Ring location/device data updated, sleeping for 5 seconds.')
    await utils.sleep(2)
    const cameras = await ringDevices.filter(d => d.device instanceof RingCamera)
    if (cameras.length > 0 && !rss.started) {
        await rss.start(cameras)
    }
    await utils.sleep(3)
}

// Publish devices/cameras for given location
async function publishDevices(location) {
    republishCount = (republishCount < 1) ? 1 : republishCount
    while (republishCount > 0 && mqttConnected) {
        try {
            const devices = await ringDevices.filter(d => d.locationId == location.locationId)
            if (devices && devices.length) {
                devices.forEach(device => {
                    // Provide location websocket connection state to device
                    device.publish(location.onConnected._value)
                })
            }
        } catch (error) {
            debug(error)
        }
        await utils.sleep(republishDelay)
        republishCount--
    }
}

// Loop through each location and call publishLocation for supported/connected devices
async function processLocations(mqttClient, ringClient) {
    // Update Ring location and device data
    await updateRingData(mqttClient, ringClient)
 
    // For each location get existing alarm & camera devices
    ringLocations.forEach(async location => {
        const devices = await ringDevices.filter(d => d.locationId == location.locationId)
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
                            debug('Websocket for location id '+location.locationId+' is connected')
                            publishDevices(location)
                        }
                    } else {
                        // Wait 30 seconds before setting devices offline in case disconnect is transient
                        // Keeps from creating "unknown" state for sensors if connection error is short lived
                        await utils.sleep(30)
                        if (!location.onConnected._value) {
                            location.isConnected = false
                            debug('Websocket for location id '+location.locationId+' is disconnected')
                            ringDevices.forEach(device => {
                                if (device.locationId == location.locationId && !device.camera) {
                                    device.offline()
                                }
                            })
                        }
                    }
                })
            } else {
                publishDevices(location)
            }
        } else {
            debug('No devices found for location ID '+location.id)
        }
    })
}

// Process received MQTT command
async function processMqttMessage(topic, message, mqttClient, ringClient) {
    message = message.toString()
    if (topic === CONFIG.hass_topic || topic === 'hass/status' || topic === 'hassio/status') {
        debug('Home Assistant state topic '+topic+' received message: '+message)
        if (message == 'online') {
            // Republish devices and state if restart of HA is detected
            if (republishCount > 0) {
                debug('Home Assisntat restart detected during existing republish cycle')
                debug('Resetting device config/state republish count')
                republishCount = 6
            } else {
                debug('Home Assistant restart detected, resending device config/state in 5 seconds')
                await utils.sleep(5)
                republishCount = 6
                processLocations(mqttClient, ringClient)
            }
        }
    } else {
        // Parse topic to get location/device ID
        const ringTopicLevels = (CONFIG.ring_topic).split('/').length
        splitTopic = topic.split('/')
        const locationId = splitTopic[ringTopicLevels]
        const deviceId = splitTopic[ringTopicLevels + 2]

        // Find existing device by matching location & device ID
        const cmdDevice = ringDevices.find(d => (d.deviceId == deviceId && d.locationId == locationId))

        if (cmdDevice) {
            const componentCommand = topic.split("/").slice(-2).join("/")
            cmdDevice.processCommand(message, componentCommand)
        } else {
            debug('Received MQTT message for device Id '+deviceId+' at location Id '+locationId+' but could not find matching device')
        }
    }
}

// Initiate the connection to MQTT broker
function initMqtt() {
    const mqtt_user = CONFIG.mqtt_user ? CONFIG.mqtt_user : null
    const mqtt_pass = CONFIG.mqtt_pass ? CONFIG.mqtt_pass : null
    const mqtt = mqttApi.connect({
        host:CONFIG.host,
        port:CONFIG.port,
        username: mqtt_user,
        password: mqtt_pass
    });
    return mqtt
}

// MQTT initialization successful, setup actions for MQTT events
function startMqtt(mqttClient, ringClient) {
    // On MQTT connect/reconnect send config/state information after delay
    mqttClient.on('connect', async function () {
        if (!mqttConnected) {
            mqttConnected = true
            debug('MQTT connection established, processing locations...')
        }
        processLocations(mqttClient, ringClient)
    })

    mqttClient.on('reconnect', function () {
        if (mqttConnected) {
            debug('Connection to MQTT broker lost. Attempting to reconnect...')
        } else {
            debug('Attempting to reconnect to MQTT broker...')
        }
        mqttConnected = false
    })

    mqttClient.on('error', function (error) {
        debug('Unable to connect to MQTT broker.', error.message)
        mqttConnected = false
    })

    // Process MQTT messages from subscribed command topics
    mqttClient.on('message', async function (topic, message) {
        processMqttMessage(topic, message, mqttClient, ringClient)
    })
}

// Create CONFIG object from file or envrionment variables
async function initConfig(configFile) {
    debug('Using configuration file: '+configFile)
    try {
        CONFIG = require(configFile)
    } catch (error) {
        debug('Configuration file not found, attempting to use environment variables for configuration.')
        CONFIG = {
            "host": process.env.MQTTHOST,
            "port": process.env.MQTTPORT,
            "ring_topic": process.env.MQTTRINGTOPIC,
            "hass_topic": process.env.MQTTHASSTOPIC,
            "mqtt_user": process.env.MQTTUSER,
            "mqtt_pass": process.env.MQTTPASSWORD,
            "ring_token": process.env.RINGTOKEN,
            "disarm_code": process.env.DISARMCODE,
            "beam_duration": process.env.BEAMDURATION,
            "enable_cameras": process.env.ENABLECAMERAS,
            "snapshot_mode": process.env.SNAPSHOTMODE,
            "livestream_user": process.env.LIVESTREAMUSER,
            "livestream_pass": process.env.LIVESTREAMPASSWORD,
            "enable_modes": process.env.ENABLEMODES,
            "enable_panic": process.env.ENABLEPANIC,
            "location_ids": process.env.RINGLOCATIONIDS
        }
        if (CONFIG.enable_cameras && CONFIG.enable_cameras != 'true') { CONFIG.enable_cameras = false}
        if (CONFIG.location_ids) { CONFIG.location_ids = CONFIG.location_ids.split(',') }
    }
    // If Home Assistant addon, always get MQTT settings from environment (set by startup script)
    if (process.env.RUNMODE === 'addon') {
        CONFIG.host = process.env.MQTTHOST
        CONFIG.port = process.env.MQTTPORT
        CONFIG.mqtt_user = process.env.MQTTUSER
        CONFIG.mqtt_pass = process.env.MQTTPASSWORD
    }

    // If there's still no configured settings, force some defaults.
    CONFIG.host = CONFIG.host ? CONFIG.host : 'localhost'
    CONFIG.port = CONFIG.port ? CONFIG.port : '1883'
    CONFIG.ring_topic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
    CONFIG.hass_topic = CONFIG.hass_topic ? CONFIG.hass_topic : 'homeassistant/status'
    if (!CONFIG.enable_cameras) { CONFIG.enable_cameras = false }
    if (!CONFIG.snapshot_mode) { CONFIG.snapshot_mode = 'disabled' }
    if (!CONFIG.enable_modes) { CONFIG.enable_modes = false }
    if (!CONFIG.enable_panic) { CONFIG.enable_panic = false }
    if (!CONFIG.beam_duration) { CONFIG.beams_duration = 0 }
    if (!CONFIG.disarm_code) { CONFIG.disarm_code = '' }

    // Make sure MQTT environment variables are set even if only using config file (standalone install)
    // (these are needed fo start_stream.sh to be able to connect to MQTT broker)
    process.env.MQTTHOST = CONFIG.host
    process.env.MQTTPORT = CONFIG.port
    process.env.MQTTUSER = CONFIG.mqtt_user
    process.env.MQTTPASSWORD = CONFIG.mqtt_pass
}

// Save updated refresh token to config or state file
async function updateToken(newRefreshToken, oldRefreshToken, stateFile, stateData, configFile) {
    if (!oldRefreshToken) { return }
    if (process.env.RUNMODE === 'addon' || process.env.RUNMODE === 'docker') {
        stateData.ring_token = newRefreshToken
        fs.writeFile(stateFile, JSON.stringify(stateData, null, 2), (err) => {
            if (err) throw err;
            debug('File ' + stateFile + ' saved with updated refresh token.')
        })
    } else if (configFile) {
        CONFIG.ring_token = newRefreshToken
        fs.writeFile(configFile, JSON.stringify(CONFIG, null, 4), (err) => {
            if (err) throw err;
            debug('Config file saved with updated refresh token.')
        })
    }
}
/* End Functions */

// Main code loop
const main = async(generatedToken) => {
    let ringAuth = new Object()
    let configFile = './config.json'
    let stateData = new Object()
    let stateFile
    let ringClient
    let mqttClient

    // For HASSIO and DOCKER latest token is saved in /data/ring-state.json
    if (process.env.RUNMODE === 'addon' || process.env.RUNMODE === 'docker') { 
        stateFile = '/data/ring-state.json'
        if (process.env.RUNMODE === 'addon') {
            configFile = '/data/options.json'
            // For addon config is performed via Web UI
            if (!tokenApp.listener) {
                tokenApp.start()
                tokenApp.token.registerListener(function(generatedToken) {
                    main(generatedToken)
                })
            }
        } else {
            configFile = '/data/config.json'
        }
    }

    // Initiate CONFIG object from file or environment variables
    await initConfig(configFile)

    // If refresh token was generated via web UI, use it, otherwise attempt to get latest token from state file
    if (stateFile) {
        if (fs.existsSync(stateFile)) {
            debug('Reading latest data from state file: '+stateFile)
            stateData = require(stateFile)
            if (generatedToken) {
                debug('Updating state data with token generated via web UI.')
                stateData.ring_token = generatedToken
            }
        } else {
            debug(colors.brightYellow('File '+stateFile+' not found. No saved state data available.'))
            if (generatedToken) {
                debug('Using refresh token generated via web UI.')
                stateData.ring_token = generatedToken
            }
        }
    }
    
    // If no refresh tokens were found, either exit or start Web UI for token generator
    if (!CONFIG.ring_token && !stateData.ring_token) {
        if (process.env.RUNMODE === 'docker') {
            debug(colors.brightRed('No refresh token was found in state file and RINGTOKEN is not configured.'))
            process.exit(2)
        } else {
            if (process.env.RUNMODE === 'addon') {
                debug(colors.brightRed('No refresh token was found in saved state file or config file.'))
                debug(colors.brightRed('Use the web interface to generate a new token.'))
            } else {
                debug(colors.brightRed('Use the web interface to generate a new token.'))
                tokenApp.start()
            }
        }
    } else {
        // There is at least one token in state file or config
        // Check if network is up before attempting to connect to Ring, wait if network is not ready
        while (!(await isOnline())) {
            debug(colors.brightYellow('Network is offline, waiting 10 seconds to check again...'))
            await utils.sleep(10)
        }

        // Define some basic parameters for connection to Ring API
        if (CONFIG.enable_cameras) {
            ringAuth = { 
                cameraStatusPollingSeconds: 20,
                cameraDingsPollingSeconds: 2
            }
        }

        if (CONFIG.enable_modes) { ringAuth.locationModePollingSeconds = 20 }
        if (!(CONFIG.location_ids === undefined || CONFIG.location_ids == 0)) {
            ringAuth.locationIds = CONFIG.location_ids
        }
        ringAuth.controlCenterDisplayName = (process.env.RUNMODE === 'addon') ? 'ring-mqtt-addon' : 'ring-mqtt'

        if (!stateData.hasOwnProperty('systemId')) {
            stateData.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
        }

        // If there is a saved or generated refresh token, try to connect using it first
        if (stateData.ring_token) {
            const tokenSource = generatedToken ? "generated" : "saved"
            debug('Attempting connection to Ring API using '+tokenSource+' refresh token.')
            ringAuth.refreshToken = stateData.ring_token
            ringAuth.systemId = stateData.systemId
            try {
                ringClient = new RingApi(ringAuth)
                await ringClient.getProfile()
            } catch(error) {
                ringClient = null
                debug(colors.brightYellow(error.message))
                debug(colors.brightYellow('Unable to connect to Ring API using '+tokenSource+' refresh token.'))
            }
        }

        // If Ring API is not already connected, try using refresh token from config file or RINGTOKEN variable
        if (!ringClient && CONFIG.ring_token) {
            const debugMsg = process.env.RUNMODE === 'docker' ? 'RINGTOKEN environment variable.' : 'refresh token from file: '+configFile
            debug('Attempting connection to Ring API using '+debugMsg)
            ringAuth.refreshToken = CONFIG.ring_token
            try {
                ringClient = new RingApi(ringAuth)
                await ringClient.getProfile()
            } catch(error) {
                ringClient = null
                debug(colors.brightRed(error.message))
                debug(colors.brightRed('Could not create the API instance. This could be because the Ring servers are down/unreachable'))
                debug(colors.brightRed('or maybe all available refresh tokens are invalid.'))
                if (process.env.RUNMODE === 'addon') {
                    debug('Restart the addon to try again or use the web interface to generate a new token.')
                } else {
                    debug('Please check the configuration and network settings, or generate a new refresh token, and try again.')
                    process.exit(2)
                }
            }
        } else if (!ringClient && !CONFIG.ring_token) {
            // No connection with Ring API using saved token and no configured token to try
            if (process.env.RUNMODE === 'docker') {
                debug(colors.brightRed('Could not connect with saved refresh token and RINGTOKEN is not configured.'))
                process.exit(2)
            } else if (process.env.RUNMODE === 'addon') {
                debug(colors.brightRed('Could not connect with saved refresh token and no refresh token exist in config file.'))
                debug(colors.brightRed('Please use the web interface to generate a new token or restart the addon to try the existing token again.'))
            }
        }
    }

    if (ringClient) {
        debug('Connection to Ring API successful')

        // Update the web app with current connected refresh token
        const currentAuth = await ringClient.restClient.authPromise
        tokenApp.updateConnectedToken(currentAuth.refresh_token)

        // Subscribed to token update events and save new token
        ringClient.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
            updateToken(newRefreshToken, oldRefreshToken, stateFile, stateData, configFile)
        })

        // Initiate connection to MQTT broker
        try {
            debug('Starting connection to MQTT broker...')
            mqttClient = await initMqtt()
            if (mqttClient.connected) {
                mqttConnected = true
                debug('MQTT connection established, sending config/state information in 5 seconds.')
            }
            // Monitor configured/default Home Assistant status topic
            mqttClient.subscribe(CONFIG.hass_topic)
            // Monitor legacy Home Assistant status topics
            mqttClient.subscribe('hass/status')
            mqttClient.subscribe('hassio/status')
            startMqtt(mqttClient, ringClient)
        } catch (error) {
            debug(error)
            debug( colors.red('Couldn\'t authenticate to MQTT broker. Please check the broker and configuration settings.'))
            process.exit(1)
        }
    }
}

// Call the main code
main()
