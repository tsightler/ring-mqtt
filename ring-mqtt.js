#!/usr/bin/env node

// Defines
const RingApi = require ('ring-client-api').RingApi
const RingDeviceType = require ('ring-client-api').RingDeviceType
const mqttApi = require ('mqtt')
const isOnline = require ('is-online')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./lib/utils.js')
const fs = require('fs')
const express = require('express')
const restClient = require('./node_modules/ring-client-api/lib/api/rest-client')
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
                publishLocation(devices, cameras)
            }
        } else {
            publishLocation(devices, cameras)
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


// The below is a quick and dirty hack to provide a web based method for
// acquiring a refresh token from Ring.com.  It's ugly, and has far too
// little (i.e. none) error handling, but seems to work well enough.
// One day I'll clean this up.  For now it only runs if ring_token is blank.
async function startWeb() {
    const webTokenApp = express()
    var client

    webTokenApp.use(bodyParser.urlencoded({ extended: false }))

    webTokenApp.get('/', function (req, res) {
        res.sendFile('./web/account.html', {root: __dirname})
    })

    webTokenApp.post('/submit-account', function (req, res) {
        const email = req.body.email
        const password = req.body.password
        res.sendFile('./web/code.html', {root: __dirname})
        client = new restClient.RingRestClient({ email, password })
    })

    webTokenApp.post('/submit-code', async function (req, res) {
        const code = req.body.code
        const token = await client.getAuth(code)
        // Super ugly...don't judge me!!!  :)
        const head = '<html><head><style>body {font-family: Arial, Helvetica, sans-serif; max-width: 500px;margin-top: 20px;word-wrap: break-word;}.button { background-color: #47a9e6; color: white; padding: 12px 20px; border: none; border-radius: 4px; cursor: pointer;}.button:hover {background-color: #315b82}</style></head><body><h3>Refresh Token</h3><b>Copy and paste the following string, exactly as shown, to ring_token:</b><br><br><textarea rows = "6" cols = "70" type="text" id="token">'
        const tail = '</textarea><br><br><button class="button" onclick="copyToClipboard()">Copy to clipboard</button><script> function copyToClipboard() { var copyText = document.getElementById("token");copyText.select();copyText.setSelectionRange(0, 99999);document.execCommand("copy");alert("The refresh token has been copied to the clipboard.");}</script></body></html>'
        res.send(head+token.refresh_token+tail)
        process.exit(0)
    })

    webTokenApp.listen(55123, function () {
        debug('No refresh token found, go to http://<ip_address>:55123/ to generate a valid token.')
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

/* End Functions */

// Main code loop
const main = async() => {
    let configFile = './config.json'
    let TOKEN = new Object()
    let tokenFile

    if (process.env.HASSADDON) { 
        configFile = '/data/options'
        tokenFile = '/data/ring_token.json'
    }

    // Get Configuration from file
    try {
        debug('Using configuration file: '+configFile)
        CONFIG = require(configFile)
    } catch (e) {
        try {
            debug('Configuration file not found, trying environment variables.')
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
            if (!CONFIG.ring_token) throw "Environemnt variable RINGTOKEN is not found but is required."
            if (CONFIG.enable_cameras && CONFIG.enable_cameras != 'true') { CONFIG.enable_cameras = false}
            if (CONFIG.location_ids) { CONFIG.location_ids = CONFIG.location_ids.split(',') } 
            CONFIG.host = CONFIG.host ? CONFIG.host : 'localhost'
            CONFIG.port = CONFIG.port ? CONFIG.port : '1883'
        }
        catch (ex) {
            debug(ex)
            debug('Configuration file not found and required environment variables are not set.')
            process.exit(1)
        }
    }

    // Set some defaults if undefined
    CONFIG.ring_topic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
    CONFIG.hass_topic = CONFIG.hass_topic ? CONFIG.hass_topic : 'hass/status'
    if (!CONFIG.enable_cameras) { CONFIG.enable_cameras = false }

    // Check if there is an updated refresh token saved in token file
    if (tokenFile) {
        try {
            debug('Reading most recent saved refresh token from: '+tokenFile)
            TOKEN = require(tokenFile)
        } catch (e) {
            debug('No updated refresh token found, will use token from config file.')
        }
    }

    if (CONFIG.ring_token) {
        let ringClient
        let mqttClient

        // Check if network is up before attempting to connect to Ring, wait if it is not ready
        while (!(await isOnline())) {
            debug('Network is offline, Waiting 10 seconds to try again...')
            await utils.sleep(10)
        }

        // Get ready to attempt connection to Ring API
        const ringAuth = { 
            cameraStatusPollingSeconds: 20,
            cameraDingsPollingSeconds: 2
        }
        if (!(CONFIG.location_ids === undefined || CONFIG.location_ids == 0)) {
            ringAuth.locationIds = CONFIG.location_ids
        }

        // If there is an updated refresh token in the token file, try to connect using it first
        if (TOKEN.ring_token) {
            debug('Attempting connection to Ring API using saved refresh token from file: '+tokenFile)
            ringAuth.refreshToken = TOKEN.ring_token
            try {
                ringClient = await new RingApi(ringAuth)
            } catch (ex) {
                debug('Unable to connect to Ring API with saved refresh token, will attempt to use the configured refresh token.')
            }
        }

        // If Ring API is not already connected, try connection using refresh token from config file 
        if (!ringClient) {
            ringAuth.refreshToken = CONFIG.ring_token  
            try {
                debug('Attempting connection to Ring API using the configured refresh token')
                ringClient = await new RingApi(ringAuth)
            } catch (ex) {
                debug( colors.red (ex) )
                debug( colors.red( 'Could not create the API instance. This could be because the Ring servers are down/unreachable' ))
                debug( colors.red( 'or maybe all available refresh tokens are invalid. Please check settings and try again.' ))
                process.exit(2)
            }
        }
        debug('Connection to Ring API successful')

        ringClient.onRefreshTokenUpdated.subscribe(
            async ({ newRefreshToken, oldRefreshToken }) => {
                if (!oldRefreshToken) { return }
                if (process.env.HASSADDON) {
                    fs.writeFile(tokenFile, JSON.stringify({ ring_token: newRefreshToken }), (err) => {
                        // throws an error, you could also catch it here
                        if (err) throw err;
                        // success case, the file was saved
                        debug('File ' + tokenFile + ' saved with updated refresh token.')
                    })
                } else if (configFile) {
                    CONFIG.ring_token = newRefreshToken
                    fs.writeFile(configFile, JSON.stringify(CONFIG, null, 4), (err) => {
                        // throws an error, you could also catch it here
                        if (err) throw err;
                        // success case, the file was saved
                        debug('Config file saved with updated refresh token.')
                    })
                }
            }
        )

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
            debug( colors.red( 'Couldn\'t connect to MQTT broker. Please check the broker and configuration settings.' ))
            process.exit(1)
        }
    } else {
        startWeb()
    }
}

// Call the main code
main()
