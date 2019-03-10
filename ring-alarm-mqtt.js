#!/usr/bin/env node

// Defines
var getAlarms = require('@dgreif/ring-alarm').getAlarms
const mqttApi = require ('mqtt')
const debug = require('debug')('ring-alarm-mqtt')
const debugError = require('debug')('error')
const debugMqtt = require('debug')('mqtt')
const colors = require( 'colors/safe' )
var CONFIG
var ringTopic
var hassTopic
var mqttClient
var ringAlarms

// Setup Exit Handwlers
process.on('exit', processExit.bind(null, {cleanup:true, exit:true}))
process.on('SIGINT', processExit.bind(null, {cleanup:true, exit:true}))
process.on('SIGTERM', processExit.bind(null, {cleanup:true, exit:true}))
process.on('uncaughtException', processExit.bind(null, {exit:true}))

/* Functions */

// Simple sleep to pause in async functions
function sleep(ms) {
 return new Promise(res => setTimeout(res, ms));
}

// Set unreachable status on exit 
async function processExit(options, exitCode) {
    if (options.cleanup) {
        ringAlarms.map(async alarm => {
            availabilityTopic = ringTopic+'/alarm/'+alarm.locationId+'/status'
            mqttClient.publish(availabilityTopic, 'offline')
        })
    }
    if (exitCode || exitCode === 0) debug('Exit code: '+exitCode)
    if (options.exit) {
        await sleep(1000)
        process.exit()
    }
}

// Monitor Alarm websocket connection and register/refresh status on connect/disconnect
async function monitorAlarmConnection(alarm) {
    alarm.onConnected.subscribe(async connected => {
        const devices = await alarm.getDevices()

        if (connected) {
            debug('Alarm location '+alarm.locationId+' is connected')
            await createAlarm(alarm)
        } else {
            const availabilityTopic = ringTopic+'/alarm/'+alarm.locationId+'/status'
            mqttClient.publish(availabilityTopic, 'offline', { qos: 1 })
            debug('Alarm location '+alarm.locationId+' is disconnected')
        }
    })
}

// Return class information if supported device
function supportedDevice(deviceType) {
    switch(deviceType) {
        case "sensor.contact":
            return {
                className: 'door',
                componentType: 'binary_sensor',
                stateOnly: true
            }
        case "sensor.motion":
            return {
                className: 'motion',
                componentType: 'binary_sensor',
                stateOnly: true
            }
        case "security-panel":
            return {
                className: null,
                componentType: 'alarm_control_panel',
                stateOnly: false
            }
    }
	
    if (/^lock($|\.)/.test(deviceType)) {
        return {
            className: null,
            componentType: 'lock',
            stateOnly: false
        }
    }
	
	return null
}

// Loop through alarm devices and create/publish MQTT device topics/messages
async function createAlarm(alarm) {
    try {
        const availabilityTopic = ringTopic+'/alarm/'+alarm.locationId+'/status'
        const devices = await alarm.getDevices()
        devices.forEach((device) => {
            const supportedDeviceInfo = supportedDevice(device.data.deviceType)
            if (supportedDeviceInfo) {
                createDevice(device, supportedDeviceInfo)
            }
        })
        await sleep(2000)
        mqttClient.publish(availabilityTopic, 'online', { qos: 1 })
    } catch (error) {
        debugError(error)
    }
}

// Register alarm devices via HomeAssistant MQTT Discovery
async function createDevice(device, supportedDeviceInfo) {
    const alarmId = device.alarm.locationId
    const deviceId = device.data.zid
    const component = supportedDeviceInfo.componentType
    
    // Build the alarm topics
    const alarmTopic = ringTopic+'/alarm/'+alarmId
    const availabilityTopic = alarmTopic+'/status'

    // Build the device topics
    const deviceTopic = alarmTopic+'/'+component+'/'+deviceId
    const stateTopic = deviceTopic+'/state'

    // Build HASS MQTT discovery topic
    const configTopic = 'homeassistant/'+component+'/'+alarmId+'/'+deviceId+'/config'
    
    // Build the MQTT discovery message
    const message = { 
        name : device.data.name,
        unique_id: device.data.zid,
        availability_topic: availabilityTopic,
        payload_available: 'online',
        payload_not_available: 'offline',
        state_topic: stateTopic
    }

    // If the device supports commands then
    // build command topic and subscribe for messages
    if (!supportedDeviceInfo.stateOnly) {
        const commandTopic = deviceTopic+'/command'
        message.command_topic = commandTopic
        mqttClient.subscribe(commandTopic)
    }

<<<<<<< HEAD
<<<<<<< HEAD
    // If device is a binary sensor include
    // device class to set correct icon in UI 
=======
    // If binary sensor, include device class to set correct icons in UI 
>>>>>>> 660d9b128d41a4532821aa2c754ca4ce316bd535
=======
    // If device is a binary sensor include
    // device class to set correct icon in UI  
>>>>>>> 821131714813b1de849ef34fdfcdfcf3d777ad0f
    if (supportedDeviceInfo.className) {
        message.device_class = supportedDeviceInfo.className
    }

    debug('HASS config topic: '+configTopic)
    debug(message)
    mqttClient.publish(configTopic, JSON.stringify(message), { qos: 1 })

    // Give Home Assistant time to configure device before sending first state data
    await sleep(2000)
    subscribeDevice(device, component, stateTopic)
}

// Publish device status and subscribe for state updates from API
function subscribeDevice(device, component, stateTopic) {
    device.onData.subscribe(data => {
        var deviceState = undefined
        debug("Component: "+component)
        switch(component) {
            case "binary_sensor":
                var deviceState = data.faulted ? 'ON' : 'OFF'
                break;
            case "alarm_control_panel":
                switch(data.mode) {
                    case 'none':
                        deviceState = "disarmed"
                        break;
                    case 'some':
                        deviceState = "armed_home"
                        break;
                    case 'all':
                        deviceState = "armed_away"
                        break;
                    default:
                        deviceState = 'unknown'
                }
                break;
            case "lock":
                switch(data.locked) {
                    case 'locked':
                        deviceState = "LOCK"
                        break;
                    case 'unlocked':
                        deviceState = "UNLOCK"
                        break;
                    default:
                        deviceState = "UNKNOWN"
                }
                break;
        }
        debug(stateTopic, deviceState)
        mqttClient.publish(stateTopic, deviceState, { qos: 1 })
    })
}

async function trySetAlarmMode(alarm, deviceId, message, delay) {
    // Pause before attempting to alarm mode -- used for retries
    await sleep(delay)
    var alarmTargetMode
    debug('Set alarm mode: '+message)
    switch(message) {
        case 'DISARM':
            alarm.disarm();
            alarmTargetMode = 'none'
            break
        case 'ARM_HOME':
            alarm.armHome()
            alarmTargetMode = 'some'
            break
        case 'ARM_AWAY':
            alarm.armAway()
            alarmTargetMode = 'all'
            break
        default:
            debug('Cannot set alarm mode: Unknown')
            return 'unknown'
    }
    // Sleep a few seconds and check if alarm entered requested mode
    await sleep(2000);
    const devices = await alarm.getDevices()
    const device = await devices.find(device => device.data.zid === deviceId)
    if (device.data.mode == alarmTargetMode) {
        debug('Alarm successfully entered mode: '+message)
        return true
    } else {
        debug('Device failed to enter requested arm/disarm mode!')
        return false
    }
}

// Set Alarm Mode on received MQTT command message
async function setAlarmMode(alarm, deviceId, message) {
    debug('Received set alarm mode '+message+' for Security Panel Id: '+deviceId)
    debug('Alarm Location Id: '+ alarm.locationId)

    // Try to set alarm mode and retry after delay if mode set fails
    // Initial attempt with no delay
    var delay = 0
    var retries = 12
    var setAlarmSuccess = false
    while (retries-- > 0 && !(setAlarmSuccess)) {
        setAlarmSuccess = await trySetAlarmMode(alarm, deviceId, message, delay*1000)
        // On failure delay 10 seconds for next set attempt
        delay = 10
    }
    // Check the return status and print some debugging for failed states
    if (setAlarmSuccess == false ) {
        debug('Device could not enter proper arming mode after all retries...Giving up!')
    } else if (setAlarmSuccess == 'unknown') {
        debug('Ignoring unknown command.')
    }
}

// Set lock target state on received MQTT command message
async function setLockTargetState(alarm, deviceId, message) {
    debug('Received set lock state '+message+' for lock Id: '+deviceId)
    debug('Alarm Location Id: '+ alarm.locationId)
    
    const command = message.toLowerCase()

    switch(command) {
        case "lock":
        case "unlock":
            alarm.setDeviceInfo(deviceId, {
                command: {
                    v1: [
                        {
                            commandType: `lock.${command}`,
                            data: {}
                        }
                    ]
                }
            })
            break;
        default:
            debug("Received invalid command for lock!")
    }
}

// Process received MQTT command
async function processCommand(topic, message) {
    var topic = topic.split("/")
    // Parse topic to get alarm/component/device info
    const alarmId = topic[topic.length - 4]
    const component = topic[topic.length - 3]
    const deviceId = topic[topic.length - 2]

    // Get alarm by location ID
    const alarm = await ringAlarms.find(alarm => alarm.locationId == alarmId)
    
    switch(component) {
        case 'alarm_control_panel':
            setAlarmMode(alarm, deviceId, message)
            break;
        case 'lock':
            setLockTargetState(alarm, deviceId, message)
            break;
        default:
            debug("Somehow received command for an unknown device!")
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

/* End Functions */

// Get Configuration from file
try {
    CONFIG = require('./config')
    ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
    hassTopic = CONFIG.hass_topic
} catch (e) {
    console.error('No configuration file found!')
    debugError(e)
    process.exit(1)
}

// Establish MQTT connection, subscribe to topics, and handle messages
const main = async() => {
    var mqttConnected = false

    try {
        // Get alarms via API
        ringAlarms = await getAlarms({
            email: CONFIG.ring_user,
            password: CONFIG.ring_pass,
        })

        // Start monitoring alarm connection state
        ringAlarms.map(async alarm => {
            monitorAlarmConnection(alarm)
        })
    
        // Connect to MQTT broker
        mqttClient = await initMqtt()
        mqttConnected = true

    } catch (error)  {
        debugError(error);
        debugError( colors.red( 'Couldn\'t create the API instance. This could be because ring.com changed their API again' ))
        debugError( colors.red( 'or maybe the password is wrong. Please check settings and try again.' ))
        process.exit(1)
    }

    mqttClient.on('connect', async function () {
        if (mqttConnected) {
            debugMqtt('Connection established with MQTT broker.')
            if (hassTopic) mqttClient.subscribe(hassTopic)
        } else {
            // Republish device state data after 5 seconds MQTT session reestablished
            debugMqtt('MQTT connection reestablished, resending config/state information in 5 seconds.')
            await sleep(5000)
            ringAlarms.map(async alarm => {
                createAlarm(alarm)
            })
        }
    })

    mqttClient.on('reconnect', function () {
        if (mqttConnected) {
            debugMqtt('Connection to MQTT broker lost. Attempting to reconnect...')
        } else {
            debugMqtt('Unable to connect to MQTT broker.')
        }
        mqttConnected = false
    })

    mqttClient.on('error', function () {
        debugMqtt('Unable to connect to MQTT broker.', error)
        mqttConnected = false
    })

    // Process MQTT messages from subscribed command topics
    mqttClient.on('message', async function (topic, message) {
        message = message.toString()
        if (topic === hassTopic) {
            // Republish devices and state after 60 seconds if restart of HA is detected
            debug('Home Assistant state topic '+topic+' received message: '+message)
            if (message == 'online') {
                debug('Resending device config/state in 45 seconds')
                await sleep(60000)
                ringAlarms.map(async alarm => {
                    createAlarm(alarm)
                    debug('Resent device config/state information')
                })
            } 
        } else {
            processCommand(topic, message)
        }
    })
}

// Call the main code
main()
