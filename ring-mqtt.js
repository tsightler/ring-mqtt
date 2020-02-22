#!/usr/bin/env node

// Defines
const RingApi = require ('ring-client-api').RingApi
const RingDeviceType = require ('ring-client-api').RingDeviceType
const mqttApi = require ('mqtt')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./lib/utils.js')
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
const Camera = require('./devices/camera')

var CONFIG
var ringTopic
var hassTopic
var mqttClient
var mqttConnected = false
var ringLocations = new Array()
var subscribedLocations = new Array()
var subscribedDevices = new Array()
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
        subscribedDevice.offline(mqttClient)
    })
    if (exitCode || exitCode === 0) debug('Exit code: '+exitCode)
    await utils.sleep(1)
    process.exit()
}

// Establich websocket connections and register/refresh location status on connect/disconnect
async function processLocations(locations) {
    // For each location get alarm devices and cameras
    ringLocations.forEach(async location => {
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
                        publishLocation(devices, cameras)
                        subscribedDevices.forEach(async subscribedDevice => {
                            // Is it an alarm device?
                            if (subscribedDevice.device) {
                                // Set availability state online
                                subscribedDevice.offline(mqttClient)
                            }
                        })
                    } else {
                        debug('Location '+location.locationId+' is disconnected')
                        publishAlarm = false
                        subscribedDevices.forEach(async subscribedDevice => {
                            // Is it an alarm device?
                            if (subscribedDevice.device) {
                                // Set availability state offline
                                subscribedDevice.offline(mqttClient)
                            }
                        })
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

// Loop through locations to publish alarms/cameras
async function publishLocation(devices, cameras) {
    if (republishCount < 1) { republishCount = 1 }
    while (republishCount > 0 && mqttConnected) {
       try {
            if (devices && devices.length > 0 && utils.hasAlarm(devices) && publishAlarm) {
                devices.forEach((device) => {
                    publishAlarmDevice(device)
                })
            }
            if (CONFIG.enable_cameras && cameras && cameras.length > 0) {
                publishCameras(cameras)
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
function getAlarmDevice(device) {
    switch (device.deviceType) {
        case RingDeviceType.ContactSensor:
        case RingDeviceType.RetrofitZone:
            return new ContactSensor(device, ringTopic)
        case RingDeviceType.MotionSensor:
            return new MotionSensor(device, ringTopic)
        case RingDeviceType.FloodFreezeSensor:
            return new FloodFreezeSensor(device, ringTopic)
        case RingDeviceType.FreezeSensor:
            return new FreezeSensor(device, ringTopic)
        case RingDeviceType.SecurityPanel:
            return new SecurityPanel(device, ringTopic)
        case RingDeviceType.SmokeAlarm:
            return new SmokeAlarm(device, ringTopic)
        case RingDeviceType.CoAlarm:
            return new CoAlarm(device, ringTopic)
        case RingDeviceType.SmokeCoListener:
            return new SmokeCoListener(device, ringTopic)
        case RingDeviceType.MultiLevelSwitch:
                if (device.categoryId == 17) {
                    return new Fan(device, ringTopic)
                } else {
                    return new MultiLevelSwitch(device, ringTopic)
                }
        case RingDeviceType.Switch:
            return new Switch(device, ringTopic)
        case RingDeviceType.TemperatureSensor:
            return new TemperatureSensor(device, ringTopic)
    }

    if (/^lock($|\.)/.test(device.deviceType)) {
        return new Lock(device, ringTopic)
    }

    return null
}

// Return class information if supported Alarm device
function publishAlarmDevice(device) {
    const existingAlarmDevice = subscribedDevices.find(d => (d.deviceId == device.zid && d.locationId == device.location.locationId))
    
    if (existingAlarmDevice) {
        debug('Republishing existing device id: '+existingAlarmDevice.deviceId)
        existingAlarmDevice.init(mqttClient)
    } else if (newAlarmDevice = getAlarmDevice(device)) {
        debug('Publishing new device id: '+newAlarmDevice.deviceId)
        newAlarmDevice.init(mqttClient)
        subscribedDevices.push(newAlarmDevice)
    } else {
        debug('!!! Found unsupported device type: '+device.deviceType+' !!!')
    }
}

// Publish all cameras for a given location
function publishCameras(cameras) {
    cameras.forEach(camera => {
        const existingCamera = subscribedDevices.find(d => (d.deviceId == camera.data.device_id && d.locationId == camera.data.location_id))
        if (existingCamera) {
            if (existingCamera.availabilityState == 'online') {
                existingCamera.init(mqttClient)
            }
        } else {
            const newCamera = new Camera(camera, ringTopic)
            newCamera.init(mqttClient)
            subscribedDevices.push(newCamera)
        }
    })
}

// Process received MQTT command
async function processMqttMessage(topic, message) {
    var message = message.toString()
    if (topic === hassTopic) {
        // Republish devices and state after 60 seconds if restart of HA is detected
        debug('Home Assistant state topic '+topic+' received message: '+message)
        if (message == 'online') {
            debug('Resending device config/state in 30 seconds')
            // Make sure any existing republish dies
            republishCount = 0 
            await utils.sleep(republishDelay+5)
            // Reset republish counter and start publishing config/state
            republishCount = 10
            processLocations(ringLocations)
            debug('Resent device config/state information')
        }
    } else {
        var topic = topic.split('/')
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

function initMqtt() {
    const mqtt = mqttApi.connect({
        host:CONFIG.host,
        port:CONFIG.port,
        username: CONFIG.mqtt_user,
        password: CONFIG.mqtt_pass
    });
    return mqtt
}

// Super simple web server for generating refreshToken
async function startWeb() {
    var app = express()
    var client

    app.use(bodyParser.urlencoded({ extended: false }))

    app.get('/', function (req, res) {
        res.sendFile('./web/account.html', {root: __dirname})
    })

    app.post('/submit-account', function (req, res) {
        const email = req.body.email
        const password = req.body.password
        res.sendFile('./web/code.html', {root: __dirname})
        client = new restClient.RingRestClient({ email, password })
    })

    app.post('/submit-code', async function (req, res) {
        const code = req.body.code
        const token = await client.getAuth(code)
        res.send('<style>p {word-wrap: break-word;}</style><body>Refresh token: <br /><p>'+token.refresh_token+'</p>')
        process.exit(0)
    })

    var server = app.listen(55123, function () {
        debug('No refresh token found, go to http://<ip_address>:55123/ to generate a valid token.')
    })
}

/* End Functions */

// Main code loop
const main = async() => {
    let locationIds = null
    let configFile = './config'
    if (process.env.HASSADDON) { configFile = '/data/options' }

    debug('Configuration file read from: '+configFile)

    // Get Configuration from file
    try {
        CONFIG = require(configFile)
        ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
        hassTopic = CONFIG.hass_topic
        if (!(CONFIG.location_ids === undefined || CONFIG.location_ids == 0)) {
            locationIds = CONFIG.location_ids
        }
    } catch (e) {
        try {
            debug('Configuration file not found, try environment variables!')
            CONFIG = {
                "host": process.env.MQTTHOST,
                "port": process.env.MQTTPORT,
                "ring_topic": process.env.MQTTRINGTOPIC,
                "hass_topic": process.env.MQTTHASSTOPIC,
                "mqtt_user": process.env.MQTTUSER,
                "mqtt_pass": process.env.MQTTPASSWORD,
                "ring_token": process.env.RINGTOKEN,
                "enable_cameras": process.env.ENABLECAMERAS
            }
            ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
            hassTopic = CONFIG.hass_topic
            if (!CONFIG.ring_token) throw "Environemnt variable RINGTOKEN is not found but is required."    
        }
        catch (ex) {
            debug(ex)
            debug('Configuration file not found and required environment variables are not set.')
            process.exit(1)
        }
    }

    if (!CONFIG.enable_cameras) { CONFIG.enable_cameras = false }

    if (CONFIG.ring_token) {
        // Establish connection to Ring API
        try {
            let auth = {
                locationIds: locationIds
            }
            auth["refreshToken"] = CONFIG.ring_token
            auth["cameraStatusPollingSeconds"] = 20
            auth["cameraDingsPollingSeconds"] = 2

            const ring = new RingApi(auth)
            ringLocations = await ring.getLocations()
            debug('Connection to Ring API successful')
        } catch (error) {
            debug(error)
            debug( colors.red( 'Couldn\'t create the API instance. This could be because the Ring servers are down/unreachable' ))
            debug( colors.red( 'or maybe the refreshToken is invalid. Please check settings and try again.' ))
            process.exit(2)
        }

        // Initiate connection to MQTT broker
        try {
            debug('Starting connection to MQTT broker.')
            mqttClient = await initMqtt()
            mqttConnected = true
            if (hassTopic) { mqttClient.subscribe(hassTopic) }
            debug('Connection established with MQTT broker, sending config/state information in 5 seconds.')
        } catch (error) {
            debug(error)
            debug( colors.red( 'Couldn\'t connect to MQTT broker. Please check the broker and configuration settings.' ))
            process.exit(1)
        }

        // On MQTT connect/reconnect send config/state information after delay
        mqttClient.on('connect', async function () {
            if (!mqttConnected) {
                mqttConnected = true
                debug('MQTT connection reestablished, resending config/state information in 5 seconds.')
            }
            await utils.sleep(5)
            processLocations(ringLocations)
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
            processMqttMessage(topic, message)
        })

    } else {
        startWeb()
    }
}

// Call the main code
main()
