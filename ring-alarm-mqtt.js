#!/usr/bin/env node

/* Defines */
const RingApi = require('ring-api');
const mqttApi = require ('mqtt');
const debug = require('debug')('ring-alarm-mqtt');
const debugError = require('debug')('error');
const debugMqtt = require('debug')('mqtt');
const colors = require( 'colors/safe' );
var mqttClient = undefined;
var connected = undefined;
var CONFIG = undefined;
var ringAlarms = undefined;
var ringAlarm = undefined;
var ringDevices = undefined
var availability_topic = undefined;

process.on('SIGINT', processExit);
process.on('SIGTERM', processExit);
process.on('exit', processExit);

/* Get Configuration from file */
try {
    CONFIG = require('./config');
    ring_topic = CONFIG.topic;
    availability_topic = ring_topic+'alarm/connected';
} catch (e) {
    console.error('No configuration file found!');
    debugError(e);
    process.exit(1);
}

/* Functions */

/* Cleanup devices on exit */
function processExit() {
    if (connected) {
        destroyRingDevices();
        setTimeout(function() {
            process.exit();
        }, 5000)
    } else {
        process.exit(1);
    }
};

/* Initialize connectiong to Ring API */
async function initRing() {
    try {
        var ring = await RingApi({
            email: CONFIG.ring_user,
            password: CONFIG.ring_pass,
            poll: false
        })
    } catch (e)  {
        debugError(e)
        debugError( colors.red( 'We couldn\'t create the API instance. This might be because ring.com changed their API again' ))
        debugError( colors.red( 'or maybe your password is wrong, in any case, sorry can\'t help you today. Bye!' ))
        process.exit(1)
    }
    return ring
}

/* Return only if device is supported */
function supportedRingDevice(ringDeviceType) {
    switch(ringDeviceType) {
        case "sensor.contact":
        case "sensor.motion":
        case "security-panel":
            return ringDeviceType
            break;
        default:
            break;
    }
}

/* Register alarm devices via HomeAssistant MQTT Discovery */
/* Also subscribed to topic for arming/disarming panel */
function createRingDevice(device, mqtt) {
    var device_id = device.data.zid
    switch(device.data.deviceType) {
        case 'sensor.contact':
            var device_class = 'door'
            var config_topic = 'homeassistant/binary_sensor/'+device_id+'/config';
            var state_topic = ring_topic+'binary_sensor/'+device_id+'/state';
            break;
        case "sensor.motion":
            var device_class = 'motion'
            var config_topic = 'homeassistant/binary_sensor/'+device_id+'/config';
            var state_topic = ring_topic+'binary_sensor/'+device_id+'/state';
            break;
        case 'security-panel':
            var device_class = 'None'
            var config_topic = 'homeassistant/alarm_control_panel/'+device_id+'/config';
            var state_topic = ring_topic+'alarm_control_panel/'+device_id+'/state';
            var command_topic = ring_topic+'alarm_control_panel/'+device_id+'/command';
            break;
    }
    var message = { name  : device.data.name
                    , device_class : device_class
                    , availability_topic : availability_topic
                    , payload_available : 'online'
                    , payload_not_available : 'offline'
                    , state_topic : state_topic
                    };
    if (command_topic) {
        message.command_topic = command_topic;
        mqtt.subscribe(command_topic);
    }
    debugMqtt(message)
    mqtt.publish(config_topic, JSON.stringify(message), { qos: 1 });
    setTimeout(function() {
    mqtt.publish(availability_topic, 'online', { qos: 1 });
        subscribeRingDevice(device, mqtt);
    }, 1000);
}

function destroyRingDevices() {
    ringDevices.forEach((ringDevice) => {
        if (supportedRingDevice(ringDevice.data.deviceType)) {
    		var device_id = ringDevice.data.zid;
    		switch(ringDevice.data.deviceType) {
        		case 'sensor.contact':
        		case 'sensor.motion':
            		var config_topic = 'homeassistant/binary_sensor/'+device_id+'/config';
            		break;
        		case 'security-panel':
            		var config_topic = 'homeassistant/alarm_control_panel/'+device_id+'/config';
            		break;
    		}
    		debug('Delete config: '+config_topic);
            mqttClient.publish(config_topic, '', { qos: 1 });
        }
    })
}

/* Subscribe and handle callbacks for supported devices */
function subscribeRingDevice(device, mqtt) {
    device.onData.subscribe(data => {
        var device_id = device.data.zid
        switch(data.deviceType) {
            case "sensor.contact":
            case "sensor.motion":
                var state_topic = ring_topic+'binary_sensor/'+device_id+'/state';
                var device_state = data.faulted ? 'ON' : 'OFF';
                break;
            case "security-panel":
                var state_topic = ring_topic+'alarm_control_panel/'+device_id+'/state';
                switch(data.mode) {
                    case 'none':
                        device_state = "disarmed";
                        break;
                    case 'some':
                        device_state = "armed_home";
                        break;
                    case 'all':
                        device_state = "armed_away";
                        break;
                    default:
                        device_state = '';
                }
        }
        mqtt.publish(state_topic, device_state, { qos: 1 });
    })
}

/* Set Alarm Mode */
function setAlarmMode(alarm,topic,message) {
    switch(message.toString()) {
        case 'DISARM':
            alarm.disarm();
            break;
        case 'ARM_HOME':
            alarm.armHome();
            break;
        case 'ARM_AWAY':
            alarm.armAway();
            break;
        default:
            break;
    }
}

function initMqtt() {
    const mqtt = mqttApi.connect({
        host: CONFIG.host,
        port: CONFIG.port,
        username: CONFIG.mqtt_user,
        password: CONFIG.mqtt_pass,
    });

    return mqtt;
}
/* End Functions */

/* Main code */
const main = async() => {
    let ringClient = await initRing()
    connected = true
    mqttClient = initMqtt()

    mqttClient.on('connect', function (error) {
        debugMqtt('Connection established with MQTT broker.');
    });

    mqttClient.on('reconnect', function (error) {
        if (mqttConnected) {
            debugMqtt('Connection to MQTT broker lost. Attempting to reconnect...');
        } else {
            debugMqtt('Unable to connect to MQTT broker.');
        }
    });

    mqttClient.on('error', function (error) {
        debugMqtt('Unable to connect to MQTT broker.', error);
    });

    /* Create alarms devices and subscribe to events for supported devices */
    try {
        ringAlarms = await ringClient.alarms();
        ringAlarm = ringAlarms[0];
        ringDevices = await ringAlarm.getDevices();
        ringDevices.forEach((ringDevice) => {
            if (supportedRingDevice(ringDevice.data.deviceType)) {
                createRingDevice(ringDevice, mqttClient)
            }
        })
    } catch (e) {
        debugError(e)
    }

    /* Set alarm mode based on MQTT subscribed command topic/message */
    mqttClient.on('message', function (message, topic) {
        try {
            setAlarmMode(ringAlarm, message, topic);
        } catch (e) {
            debugError(e)
        }
    });
}

/* Call the main code */
main()
