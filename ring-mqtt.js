#!/usr/bin/env node

// Defines
const RingApi = require ('ring-client-api').RingApi
const RingDeviceType = require ('ring-client-api').RingDeviceType
const RingRestClient = require('./node_modules/ring-client-api/lib/api/rest-client').RingRestClient
const mqttApi = require ('mqtt')
const isOnline = require ('is-online')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./lib/utils.js')
const fs = require('fs')
const express = require('express')
const bodyParser = require("body-parser")
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

var CONFIG
var subscribedLocations = new Array()
var subscribedDevices = new Array()
var mqttConnected = false
var publishAlarm = true  // Flag to stop publish/republish if connection is down
var republishCount = 10 // Republish config/state this many times after startup or HA start/restart
var republishDelay = 30 // Seconds

// Setup Exit Handwlers
process.on('exit', processExit.bind(null, 0))
process.on('SIGINT', processExit.bind(null, 0))
process.on('SIGTERM', processExit.bind(null, 0))
process.on('uncaughtException', processExit.bind(null, 1))

// Set unreachable status on exit
async function processExit(options, exitCode) {
    subscribedDevices.forEach(subscribedDevice => {
        subscribedDevice.offline()
    })
    if (exitCode || exitCode === 0) debug('Exit code: '+exitCode)
    await utils.sleep(1)
    process.exit()
}

// Loop through each location and call publishLocation for supported/connected devices
// TODO:  This function stops publishing discovery for all locations even if only one
//        location is offline.  Should be fixed to be per location.
async function processLocations(mqttClient, ringClient) {
    // For each location get alarm devices and cameras
    const locations = await ringClient.getLocations()
    locations.forEach(async location => {
        const devices = await location.getDevices()
        const cameras = await location.cameras

        // If this is initial publish then publish alarms and cameras
        if (!(subscribedLocations.includes(location.locationId))) {
            subscribedLocations.push(location.locationId)
            if (devices && devices.length > 0 && utils.hasAlarm(devices)) {
                // For alarm subscribe to websocket connection monitor
                location.onConnected.subscribe(async connected => {
                    if (connected) {
                        debug('Location '+location.locationId+' is connected')
                        publishAlarm = true
                        publishLocation(devices, cameras, mqttClient)
                        setLocationOnline(location)
                    } else {
                        debug('Location '+location.locationId+' is disconnected')
                        publishAlarm = false
                        setLocationOffline(location)
                    }
                })
            // If location has no alarm but has cameras publish cameras only
            } else if (cameras && cameras.length > 0) {
                publishLocation(devices, cameras, mqttClient)
            }
        } else {
            publishLocation(devices, cameras, mqttClient)
        }
    })
}

// Set all devices for location online
async function setLocationOnline(location) {
    subscribedDevices.forEach(async subscribedDevice => {
        if (subscribedDevice.locationId == location.locationId && subscribedDevice.device) { 
            subscribedDevice.online()
        }
    })
}

// Set all devices for location offline
async function setLocationOffline(location) {
    // Wait 30 seconds before setting devices offline in case disconnect is transient
    // Keeps from creating "unknown" state for sensors if connection error is short lived
    await utils.sleep(30)
    if (location.onConnected._value) { return }
    subscribedDevices.forEach(async subscribedDevice => {
        if (subscribedDevice.locationId == location.locationId && subscribedDevice.device) { 
            subscribedDevice.offline()
        }
    })
}

// Publish alarms/cameras for given location
async function publishLocation(devices, cameras, mqttClient) {
    if (republishCount < 1) { republishCount = 1 }
    while (republishCount > 0 && mqttConnected) {
       try {
            if (devices && devices.length > 0 && utils.hasAlarm(devices) && publishAlarm) {
                devices.forEach((device) => {
                    publishAlarmDevice(device, mqttClient)
                })
            }
            if (CONFIG.enable_cameras && cameras && cameras.length > 0) {
                publishCameras(cameras, mqttClient)
            }
            await utils.sleep(1)
        } catch (error) {
                debug(error)
        }
    await utils.sleep(republishDelay)
    republishCount--
    }
}

// Return supportted alarm device class
function getAlarmDevice(device, mqttClient, ringTopic) {
    switch (device.deviceType) {
        case RingDeviceType.ContactSensor:
        case RingDeviceType.RetrofitZone:
            return new ContactSensor(device, mqttClient, ringTopic)
        case RingDeviceType.MotionSensor:
            return new MotionSensor(device, mqttClient, ringTopic)
        case RingDeviceType.FloodFreezeSensor:
            return new FloodFreezeSensor(device, mqttClient, ringTopic)
        case RingDeviceType.SecurityPanel:
            return new SecurityPanel(device, mqttClient, ringTopic)
        case RingDeviceType.SmokeAlarm:
            return new SmokeAlarm(device, mqttClient, ringTopic)
        case RingDeviceType.CoAlarm:
            return new CoAlarm(device, mqttClient, ringTopic)
        case RingDeviceType.SmokeCoListener:
            return new SmokeCoListener(device, mqttClient, ringTopic)
        case RingDeviceType.BeamsMotionSensor:
        case RingDeviceType.BeamsSwitch:
        case RingDeviceType.BeamsTransformerSwitch:
        case RingDeviceType.BeamsLightGroupSwitch:
            return new Beam(device, mqttClient, ringTopic)
        case RingDeviceType.MultiLevelSwitch:
                if (device.categoryId == 17) {
                    return new Fan(device, mqttClient, ringTopic)
                } else {
                    return new MultiLevelSwitch(device, mqttClient, ringTopic)
                }
        case RingDeviceType.Switch:
            return new Switch(device, mqttClient, ringTopic)
    }

    if (/^lock($|\.)/.test(device.deviceType)) {
        return new Lock(device, mqttClient, ringTopic)
    }

    return null
}

// Publish an individual alarm device
function publishAlarmDevice(device, mqttClient) {
    const existingAlarmDevice = subscribedDevices.find(d => (d.deviceId == device.zid && d.locationId == device.location.locationId))    
    if (existingAlarmDevice) {
        debug('Republishing existing device id: '+existingAlarmDevice.deviceId)
        existingAlarmDevice.init()
    } else {
        const newAlarmDevice = getAlarmDevice(device, mqttClient, CONFIG.ring_topic)
        if (newAlarmDevice) {
            debug('Publishing new device id: '+newAlarmDevice.deviceId)
            newAlarmDevice.init()
            subscribedDevices.push(newAlarmDevice)
        } else {
            debug('!!! Found unsupported device type: '+device.deviceType+' !!!')
        }
    }
}

// Publish all cameras for a given location
function publishCameras(cameras, mqttClient) {
    cameras.forEach(camera => {
        const existingCamera = subscribedDevices.find(d => (d.deviceId == camera.data.device_id && d.locationId == camera.data.location_id))
        if (existingCamera) {
            if (existingCamera.availabilityState == 'online') {
                existingCamera.init()
            }
        } else {
            const newCamera = new Camera(camera, mqttClient, CONFIG.ring_topic)
            newCamera.init()
            subscribedDevices.push(newCamera)
        }
    })
}

// Process received MQTT command
async function processMqttMessage(topic, message, mqttClient, ringClient) {
    message = message.toString()
    if (topic === CONFIG.hass_topic) {
        // Republish devices and state after 60 seconds if restart of HA is detected
        debug('Home Assistant state topic '+topic+' received message: '+message)
        if (message == 'online') {
            debug('Resending device config/state in 30 seconds')
            // Make sure any existing republish dies
            republishCount = 0 
            await utils.sleep(republishDelay+5)
            // Reset republish counter and start publishing config/state
            republishCount = 10
            processLocations(mqttClient, ringClient)
            debug('Resent device config/state information')
        }
    } else {
        topic = topic.split('/')
        // Parse topic to get location/device ID
        const locationId = topic[topic.length - 5]
        const deviceId = topic[topic.length - 2]

        // Some devices use the command topic level to determine the device action
        const commandTopicLevel = topic[topic.length - 1]

        // Find existing device by matching location & device ID
        const cmdDevice = subscribedDevices.find(d => (d.deviceId == deviceId && d.locationId == locationId))

        if (cmdDevice) {
            cmdDevice.processCommand(message, commandTopicLevel)
        } else {
            debug('Received MQTT message for device Id '+deviceId+' at location Id '+locationId+' but could not find matching device')
        }
    }
}


// This is a quick and dirty hack to provide a web based method for
// acquiring a refresh token from Ring.com.  It's ugly, and has too
// little error handling, but seems to work well enough for now.
async function startWeb() {
    const webTokenApp = express()
    let restClient

    const listener = webTokenApp.listen(55123, () => {
        debug('Go to http://<host_ip_address>:55123/ to generate a valid token.')
    })

    webTokenApp.use(bodyParser.urlencoded({ extended: false }))

    webTokenApp.get('/', (req, res) => {
        res.sendFile('./web/account.html', {root: __dirname})
    })

    webTokenApp.post('/submit-account', async (req, res) => {
        const email = req.body.email
        const password = req.body.password
        let errmsg
        restClient = await new RingRestClient({ email, password })
        // Check if the user/password was accepted
        try {
            await restClient.getAuth()
        } catch(error) {
            errmsg = error.message
        }
        debug(errmsg)
        if (errmsg.match(/^Your Ring account is configured to use 2-factor authentication.*$/)) {
            debug('Username/Password was accepted, waiting for 2FA code to be entered.')
            res.sendFile('./web/code.html', {root: __dirname})
        } else {
            debug('Authentication error, check username/password and try again.')
            res.sendFile('./web/account-error.html', {root: __dirname})
        }
    })

    webTokenApp.post('/submit-code', async (req, res) => {
        let token
        const code = req.body.code
        try {
            token = await restClient.getAuth(code)
        } catch(error) {
            token = ''
            debug(error.message)
            res.sendFile('./web/code-error.html', {root: __dirname})
        }
        if (token) {
            if (process.env.HASSADDON) {
                res.sendFile('./web/restart.html', {root: __dirname})
                listener.close()
                main(token.refresh_token)
            } else {
                // Super ugly...don't judge me!!!  :)
                const head = '<html><head><style>body {font-family: Arial, Helvetica, sans-serif; max-width: 500px;margin-top: 20px;word-wrap: break-word;}.button { background-color: #47a9e6; color: white; padding: 12px 20px; border: none; border-radius: 4px; cursor: pointer;}.button:hover {background-color: #315b82}</style></head><body><h3>Refresh Token</h3><b>Copy and paste the following string, exactly as shown, to ring_token:</b><br><br><textarea rows = "6" cols = "70" type="text" id="token">'
                const tail = '</textarea><br><br><button class="button" onclick="copyToClipboard()">Copy to clipboard</button><script> function copyToClipboard() { var copyText = document.getElementById("token");copyText.select();copyText.setSelectionRange(0, 99999);document.execCommand("copy");alert("The refresh token has been copied to the clipboard.");}</script></body></html>'
                res.send(head+token.refresh_token+tail)
                process.exit(0)
            }
        }
    })
}

function initMqtt() {
    const mqtt = mqttApi.connect({
        host:CONFIG.host,
        port:CONFIG.port,
        username: CONFIG.mqtt_user,
        password: CONFIG.mqtt_pass
    });
    return mqtt
}

function startMqtt(mqttClient, ringClient) {
        // On MQTT connect/reconnect send config/state information after delay
        mqttClient.on('connect', async function () {
            if (!mqttConnected) {
                mqttConnected = true
                debug('MQTT connection established, sending config/state information in 5 seconds.')
            }
            await utils.sleep(5)
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
                "enable_cameras": process.env.ENABLECAMERAS,
                "location_ids" : process.env.RINGLOCATIONIDS
            }
            if (CONFIG.enable_cameras && CONFIG.enable_cameras != 'true') { CONFIG.enable_cameras = false}
            if (CONFIG.location_ids) { CONFIG.location_ids = CONFIG.location_ids.split(',') }
        }
        // Set some defaults if undefined
        CONFIG.host = CONFIG.host ? CONFIG.host : 'localhost'
        CONFIG.port = CONFIG.port ? CONFIG.port : '1883'
        CONFIG.ring_topic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
        CONFIG.hass_topic = CONFIG.hass_topic ? CONFIG.hass_topic : 'homeassistant/status'
        if (!CONFIG.enable_cameras) { CONFIG.enable_cameras = false }
    }

    async function updateToken(newRefreshToken, oldRefreshToken, stateFile, configFile) {
        if (!oldRefreshToken) { return }
        if (process.env.HASSADDON || process.env.ISDOCKER) {
            fs.writeFile(stateFile, JSON.stringify({ ring_token: newRefreshToken }), (err) => {
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
    if (process.env.HASSADDON || process.env.ISDOCKER) { 
        configFile = (process.env.HASSADDON) ? '/data/options.json' : '/data/config.json'
        stateFile = '/data/ring-state.json'
    }

    // Initiate CONFIG object from file or environment variables
    await initConfig(configFile)

    // If refresh token was generated via web UI, use it, otherwise attempt to get latest token from state file
    if (generatedToken) {
        debug('Using refresh token generated via web UI.')
        stateData.ring_token = generatedToken
    } else if (stateFile) {
        if (fs.existsSync(stateFile)) {
            debug('Reading latest data from state file: '+stateFile)
            stateData = require(stateFile)
        } else {
            debug('File '+stateFile+' not found. No saved state data available.')
        }
    }
    
    // If no refresh tokens were found, either exit or start Web UI for token generator
    if (!CONFIG.ring_token && !stateData.ring_token) {
        if (process.env.ISDOCKER) {
            debug('No refresh token was found in state file and RINGTOKEN is not configured.')
            process.exit(2)
        } else {
            if (process.env.HASSADDON) {
                debug('No refresh token was found in saved state file or config file.')
            } else {
                debug('No refresh token was found in config file.')
            }
            startWeb()
        }
    } else {
        // There is at least one token in state file or config
        // Check if network is up before attempting to connect to Ring, wait if network is not ready
        while (!(await isOnline())) {
            debug('Network is offline, waiting 10 seconds to check again...')
            await utils.sleep(10)
        }

        // Define some basic parameters for connection to Ring API
        if (CONFIG.enable_cameras) {
            ringAuth = { 
                cameraStatusPollingSeconds: 20,
                cameraDingsPollingSeconds: 2
            }
        }
        if (!(CONFIG.location_ids === undefined || CONFIG.location_ids == 0)) {
            ringAuth.locationIds = CONFIG.location_ids
        }

        // If there is a saved or generated refresh token, try to connect using it first
        if (stateData.ring_token) {
            const tokenSource = generatedToken ? "generated" : "saved"
            debug('Attempting connection to Ring API using '+tokenSource+' refresh token.')
            ringAuth.refreshToken = stateData.ring_token
            try {
                ringClient = new RingApi(ringAuth)
                await ringClient.getLocations()
            } catch(error) {
                ringClient = null
                debug(colors.brightYellow(error.message))
                debug(colors.brightYellow('Unable to connect to Ring API using '+tokenSource+' refresh token.'))
            }
        }

        // If Ring API is not already connected, try using refresh token from config file or RINGTOKEN variable
        if (!ringClient && CONFIG.ring_token) {
            const debugMsg = process.env.ISDOCKER ? 'RINGTOKEN environment variable.' : 'refresh token from file: '+configFile
            debug('Attempting connection to Ring API using '+debugMsg)
            ringAuth.refreshToken = CONFIG.ring_token
            try {
                ringClient = new RingApi(ringAuth)
                await ringClient.getLocations()
            } catch(error) {
                ringClient = null
                debug(colors.brightRed(error.message))
                debug(colors.brightRed('Could not create the API instance. This could be because the Ring servers are down/unreachable'))
                debug(colors.brightRed('or maybe all available refresh tokens are invalid.'))
                if (process.env.HASSADDON) {
                    debug('Restart the addon to try again or use the web interface to generate a new token.')
                    startWeb()
                } else {
                    debug('Please check the configuration and network settings, or generate a new refresh token, and try again.')
                    process.exit(2)
                }
            }
        } else if (!ringClient && !CONFIG.ring_token) {
            // No connection with Ring API using saved token and no configured token to try
            if (process.env.ISDOCKER) {
                debug('Could not connect with saved refresh token and RINGTOKEN is not configured.')    
                process.exit(2)
            } else if (process.env.HASSADDON) {
                debug('Could not connect with saved refresh token and no refresh token exist in config file.')
                debug('Restart the addon to try again or use the web interface to generate a new token.')
                startWeb()
            }
        }
    }

    if (ringClient) {
        debug('Connection to Ring API successful')

        // Subscribed to token update events and save new token
        ringClient.onRefreshTokenUpdated.subscribe( async ({ newRefreshToken, oldRefreshToken }) => {
            updateToken(newRefreshToken, oldRefreshToken, stateFile, configFile)
        })

        // Initiate connection to MQTT broker
        try {
            debug('Starting connection to MQTT broker...')
            mqttClient = await initMqtt()
            if (mqttClient.connected) {
                mqttConnected = true
                debug('MQTT connection established, sending config/state information in 5 seconds.')
            }
            mqttClient.subscribe(CONFIG.hass_topic)
            startMqtt(mqttClient, ringClient)
        } catch (error) {
            debug(error)
            debug( colors.red('Couldn\'t connect to MQTT broker. Please check the broker and configuration settings.'))
            process.exit(1)
        }
    }
}

// Call the main code
main()
