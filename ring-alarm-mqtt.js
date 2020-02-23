#!/usr/bin/env node

// Defines
const RingApi = require('ring-client-api').RingApi;
const mqttApi = require('mqtt');
const debug = require('debug')('ring-alarm-mqtt');
const debugError = require('debug')('error');
const debugMqtt = require('debug')('mqtt');
const colors = require( 'colors/safe' );

let CONFIG;
let ringTopic;
let hassTopic;
let mqttClient;
let mqttConnected = false;
let ringLocations = [];
const subscribedLocations = [];
const subscribedDevices = [];
let publishEnabled = true; // Flag to stop publish/republish if connection is down
let republishCount = 10; // Republish config/state this many times after startup or HA start/restart
const republishDelay = 30; // Seconds

// Setup Exit Handwlers
process.on('exit', processExit.bind(null, {cleanup: true, exit: true}));
process.on('SIGINT', processExit.bind(null, {cleanup: true, exit: true}));
process.on('SIGTERM', processExit.bind(null, {cleanup: true, exit: true}));
process.on('uncaughtException', processExit.bind(null, {exit: true}));

/**
 * Simple sleep to pause in async functions
 * @param {number} sec
 * @return {Promise}
 */
function sleep(sec) {
  return new Promise((res) => setTimeout(res, sec*1000));
}

/**
 * Set unreachable status on exit
 * @param {Object} options
 * @param {Number} exitCode
 */
async function processExit(options, exitCode) {
  if (options.cleanup) {
    ringLocations.forEach(async (location) => {
      availabilityTopic = ringTopic+'/'+location.locationId+'/status';
      mqttClient.publish(availabilityTopic, 'offline');
    });
  }
  if (exitCode || exitCode === 0) debug('Exit code: '+exitCode);
  if (options.exit) {
    await sleep(1);
    process.exit();
  }
}

/**
 * Check if location has alarm panel (could be only camera/lights)
 * @param {Object} location
 * @return {Boolean}
 */
async function hasAlarm(location) {
  const devices = await location.getDevices();
  if (devices.filter((device) => device.data.deviceType === 'security-panel')) {
    return true;
  }
  return false;
}

/**
 * Establich websocket connections and register/refresh location status on connect/disconnect
 * @param {Array} locations
 */
async function processLocations(locations) {
  ringLocations.forEach(async (location) => {
    if (!(subscribedLocations.includes(location.locationId)) && await hasAlarm(location)) {
      subscribedLocations.push(location.locationId);
      location.onConnected.subscribe(async (connected) => {
        if (connected) {
          debug('Location '+location.locationId+' is connected');
          publishEnabled = true;
          publishAlarm(location);
        } else {
          publishEnabled = false;
          const availabilityTopic = ringTopic+'/'+location.locationId+'/status';
          mqttClient.publish(availabilityTopic, 'offline', {qos: 1});
          debug('Location '+location.locationId+' is disconnected');
        }
      });
    } else {
      publishAlarm(location);
    }
  });
}

/**
 * Return class information if supported device
 * @param {Object} device
 */
function supportedDevice(device) {
  switch (device.data.deviceType) {
    case 'sensor.contact':
      device.className = 'door';
      device.component = 'binary_sensor';
      break;
    case 'switch.multilevel':
      device.component = 'light';
      device.command = true;
      device.brightness_command = true;
      break;
    case 'switch.multilevel.beams':
      // TODO: cannot support multi components from one thing.
      device.component = 'light';
      device.suffixNames = ['Battery'];
      device.classNames = ['battery'];
      device.command = true;
      device.brightness_command = true;
      break;
    case 'sensor.motion':
      device.className = 'motion';
      device.component = 'binary_sensor';
      break;
      // TODO: might be able to combine these two doing some magic
    case 'alarm.smoke':
      device.className = 'smoke';
      device.component = 'binary_sensor';
      break;
    case 'alarm.co':
      device.className = 'gas';
      device.component = 'binary_sensor';
      break;
    case 'listener.smoke-co':
      device.classNames = ['smoke', 'gas'];
      device.suffixNames = ['Smoke', 'CO'];
      device.component = 'binary_sensor';
      break;
    case 'sensor.flood-freeze':
      device.classNames = ['moisture', 'cold'];
      device.suffixNames = ['Flood', 'Freeze'];
      device.component = 'binary_sensor';
      break;
    case 'security-panel':
      device.component = 'alarm_control_panel';
      device.command = true;
      break;
    case 'security-keypad':
      device.component = 'sensor';
      device.className = 'battery';
      device.unitOfMeasurement = '%';
      break;
  }

  // Check if device is a lock
  if (/^lock($|\.)/.test(device.data.deviceType)) {
    device.component = 'lock';
    device.command = true;
  }
}

/**
 * Get battery level for a device
 * @param {Object} device
 * @return {Number}
 */
function getBatteryLevel(device) {
  if (device.batteryLevel !== undefined) {
    // Return 100% if 99% reported, otherwise return reported battery level
    return (device.batteryLevel === 99) ? 100 : device.batteryLevel;
  } else if (device.batteryStatus === 'full') {
    return 100;
  } else if (device.batteryStatus === 'ok') {
    return 50;
  } else if (device.batteryStatus === 'none') {
    return 'none';
  }
  return 0;
}

/**
 * Loop through alarm devices at location and publish each one
 * @param {Object} location
 */
async function publishAlarm(location) {
  if (republishCount < 1) {
    republishCount = 1;
  }
  while (republishCount > 0 && publishEnabled && mqttConnected) {
    try {
      const availabilityTopic = ringTopic+'/'+location.locationId+'/status';
      const devices = await location.getDevices();
      devices.forEach((device) => {
        // try {
        //   const deviceClass = new Device(device);
        //   console.log(deviceClass);
        // } catch (e) {
        //   console.error('[ERROR]', e);
        // }

        supportedDevice(device);
        if (device.component) {
          publishDevice(device);
        }
      });
      await sleep(1);
      mqttClient.publish(availabilityTopic, 'online', {qos: 1});
    } catch (error) {
      debugError(error);
    }
    await sleep(republishDelay);
    republishCount--;
  }
}

const ringDevices = {
  'ring-beams-c40': {
    manufacturerName: 'Ring',
    model: 'Steplight',
  },
  'ring-beams-c50': {
    manufacturerName: 'Ring',
    model: 'Pathlight',
  },
};

/**
 * Get device details
 * @param {Object} param.data
 * @return {Object}
 */
function getDeviceDetails({data}) {
  const device = {
    identifiers: data.serialNumber || data.zid,
    name: data.name,
    manufacturer: data.manufacturerName,
    // TODO: be able to override a model for a given serial number
    // TODO: be able to override a manufactuerer for a given serial number
    // TODO: be able to override
  };

  if (Object.keys(ringDevices).includes(data.fingerprint)) {
    device.manufacturer = ringDevices[data.fingerprint].manufacturerName;
    device.model = ringDevices[data.fingerprint].model;
  }

  return device;
}

/**
 * Register all device sensors via HomeAssistant MQTT Discovery and
 * subscribe to command topic if device accepts commands
 * @param {Object} device
 */
async function publishDevice(device) {
  const locationId = device.location.locationId;
  const numSensors = (!device.classNames) ? 1 : device.classNames.length;

  // Build alarm, availability and device topic
  const alarmTopic = ringTopic+'/'+locationId+'/alarm';
  const availabilityTopic = ringTopic+'/'+locationId+'/status';
  const deviceTopic = alarmTopic+'/'+device.component+'/'+device.zid;

  // Loop through device sensors and publish HA discovery configuration
  for (let i=0; i < numSensors; i++) {
    // If device has more than one sensor component create suffixes
    // to build unique device entries for each sensor
    const className = numSensors > 1 ? device.classNames[i] : device.className;
    const deviceName = numSensors > 1 ? `${device.name} - ${device.suffixNames[i]}` : device.name;
    const sensorId = numSensors > 1 ? `${device.zid}_${className}` : device.zid;
    const sensorTopic = numSensors > 1 ? `${deviceTopic}/${className}` : deviceTopic;
    const unitOfMeasurement = device.unitOfMeasurement;

    // Build state topic and HASS MQTT discovery topic
    const stateTopic = `${sensorTopic}/state`;
    const attributesTopic = `${deviceTopic}/attributes`;
    const configTopic = `homeassistant/${device.component}/${locationId}/${sensorId}/config`;

    // Build the MQTT discovery message
    const message = {
      name: deviceName,
      unique_id: sensorId,
      availability_topic: availabilityTopic,
      payload_available: 'online',
      payload_not_available: 'offline',
      state_topic: stateTopic,
      json_attributes_topic: attributesTopic,

      // TODO: A device that offers multiple endpoints, where parts of the device sense or output in different areas,
      // should be split into separate devices and refer back to parent device with the via_device attribute. This
      // allows the separate endpoints to be assigned to different areas in the building.
      // See: https://developers.home-assistant.io/docs/en/device_registry_index.html
      device: getDeviceDetails(device),
    };

    // If device supports commands then
    // build command topic and subscribe for updates
    if (device.command) {
      const commandTopic = `${sensorTopic}/command`;
      message.command_topic = commandTopic;
      mqttClient.subscribe(commandTopic);
    }

    // If device supports brightness command, then... yeah
    if (device.brightness_command) {
      const brightnessCommandTopic = `${sensorTopic}/brightness`;
      message.brightness_command_topic = brightnessCommandTopic;
      mqttClient.subscribe(brightnessCommandTopic);
    }

    // If binary sensor include device class to help set icons in UI
    if (className) {
      message.device_class = className;
    }

    if (unitOfMeasurement) {
      message.unit_of_measurement = unitOfMeasurement;
    }

    debug('HASS config topic: '+configTopic);
    debug(message);
    mqttClient.publish(configTopic, JSON.stringify(message), {qos: 1});
  }
  // Give Home Assistant time to configure device before sending first state data
  await sleep(2);

  // Publish device data and, if newly registered device, subscribe to state updates
  if (subscribedDevices.find((subscribedDevice) => subscribedDevice.zid === device.zid)) {
    publishDeviceData(device.data, deviceTopic);
  } else {
    device.onData.subscribe((data) => {
      publishDeviceData(data, deviceTopic);
    });
    subscribedDevices.push(device);
  }
}

/**
 * Publish device state data
 * @param {Object} data
 * @param {String} deviceTopic
 */
function publishDeviceData(data, deviceTopic) {
  let deviceState;
  switch (data.deviceType) {
    case 'sensor.contact':
    case 'sensor.motion':
      deviceState = data.faulted ? 'ON' : 'OFF';
      break;
    case 'switch.multilevel':
      deviceState = data.on ? 'ON' : 'OFF';
      publishMqttState(deviceTopic + '/light/status', deviceState);
      publishMqttState(deviceTopic + '/brightness/set', (data.level * 255)+'');
      break;
    case 'switch.multilevel.beams':
      deviceState = data.on ? 'ON' : 'OFF';
      publishMqttState(deviceTopic + '/light/status', deviceState);
      publishMqttState(deviceTopic + '/brightness/set', (data.level * 255)+'');
      break;
    case 'alarm.smoke':
    case 'alarm.co':
      deviceState = data.alarmStatus === 'active' ? 'ON' : 'OFF';
      break;
    case 'listener.smoke-co':
      const coAlarmState = data.co && data.co.alarmStatus === 'active' ? 'ON' : 'OFF';
      const smokeAlarmState = data.smoke && data.smoke.alarmStatus === 'active' ? 'ON' : 'OFF';
      publishMqttState(deviceTopic+'/gas/state', coAlarmState);
      publishMqttState(deviceTopic+'/smoke/state', smokeAlarmState);
      break;
    case 'sensor.flood-freeze':
      const floodAlarmState = data.flood && data.flood.faulted ? 'ON' : 'OFF';
      const freezeAlarmState = data.freeze && data.freeze.faulted ? 'ON' : 'OFF';
      publishMqttState(deviceTopic+'/moisture/state', floodAlarmState);
      publishMqttState(deviceTopic+'/cold/state', freezeAlarmState);
      break;
    case 'security-panel':
      switch (data.mode) {
        case 'none':
          deviceState = 'disarmed';
          break;
        case 'some':
          deviceState = 'armed_home';
          break;
        case 'all':
          deviceState = 'armed_away';
          break;
        default:
          deviceState = 'unknown';
      }
      break;
    case 'security-keypad':
      const batteryState = data.batteryLevel;
      deviceState = batteryState + '';
      break;
  }

  if (/^lock($|\.)/.test(data.deviceType)) {
    switch (data.locked) {
      case 'locked':
        deviceState = 'LOCK';
        break;
      case 'unlocked':
        deviceState = 'UNLOCK';
        break;
      default:
        deviceState = 'UNKNOWN';
    }

    if (deviceState !== undefined) {
      publishMqttState(`${deviceTopic}/state`, deviceState);
    }
  }

  // Publish any available device attributes (battery, power, etc)
  const attributes = {};
  batteryLevel = getBatteryLevel(data);
  if (batteryLevel !== 'none') {
    attributes.battery_level = batteryLevel;
  }
  if (data.tamperStatus) {
    attributes.tamper_status = data.tamperStatus;
  }

  // TODO: something bad be in here
  // attributes.data = data;

  publishMqttState(deviceTopic+'/attributes', JSON.stringify(attributes));
}

/**
 * Simple function to publish MQTT state messages with debug
 * @param {String} topic
 * @param {String} message
 */
function publishMqttState(topic, message) {
  debug(topic, message);
  mqttClient.publish(topic, message, {qos: 1});
}

/**
 * Try to set alarm mode
 * @param {Object} location
 * @param {String} deviceId
 * @param {String} message
 * @param {Number} delay
 */
async function trySetAlarmMode(location, deviceId, message, delay) {
  // Pause before attempting to set alarm mode -- used for retries
  await sleep(delay);
  let alarmTargetMode;
  debug('Set alarm mode: '+message);
  switch (message) {
    case 'DISARM':
      location.disarm();
      alarmTargetMode = 'none';
      break;
    case 'ARM_HOME':
      location.armHome();
      alarmTargetMode = 'some';
      break;
    case 'ARM_AWAY':
      location.armAway();
      alarmTargetMode = 'all';
      break;
    default:
      debug('Cannot set alarm mode: Unknown');
      return 'unknown';
  }
  // Sleep a few seconds and check if alarm entered requested mode
  await sleep(2);
  const devices = await location.getDevices();
  const device = await devices.find((device) => device.data.zid === deviceId);
  if (device.data.mode == alarmTargetMode) {
    debug('Alarm successfully entered mode: '+message);
    return true;
  } else {
    debug('Device failed to enter requested arm/disarm mode!');
    return false;
  }
}

/**
 * Set Alarm Mode on received MQTT command message
 * @param {Object} location
 * @param {String} deviceId
 * @param {String} message
 */
async function setAlarmMode(location, deviceId, message) {
  debug('Received set alarm mode '+message+' for Security Panel Id: '+deviceId);
  debug('Location Id: '+ location.locationId);

  // Try to set alarm mode and retry after delay if mode set fails
  // Initial attempt with no delay
  let delay = 0;
  let retries = 12;
  let setAlarmSuccess = false;
  while (retries-- > 0 && !(setAlarmSuccess)) {
    setAlarmSuccess = await trySetAlarmMode(location, deviceId, message, delay);
    // On failure delay 10 seconds for next set attempt
    delay = 10;
  }
  // Check the return status and print some debugging for failed states
  if (setAlarmSuccess == false ) {
    debug('Device could not enter proper arming mode after all retries...Giving up!');
  } else if (setAlarmSuccess == 'unknown') {
    debug('Ignoring unknown command.');
  }
}

/**
 * Set lock target state on received MQTT command message
 * @param {Object} location
 * @param {String} deviceId
 * @param {String} message
 */
async function setLockTargetState(location, deviceId, message) {
  debug('Received set lock state '+message+' for lock Id: '+deviceId);
  debug('Location Id: '+ location.locationId);

  const command = message.toLowerCase();

  switch (command) {
    case 'lock':
    case 'unlock':
      const devices = await location.getDevices();
      const device = devices.find((device) => device.id === deviceId);
      if (!device) {
        debug('Cannot find specified device id in location devices');
        break;
      }
      device.sendCommand(`lock.${command}`);
      break;
    default:
      debug('Received invalid command for lock!');
  }
}

/**
 * Set light switch target state on received MQTT command message
 * @param {Object} location
 * @param {String} deviceId
 * @param {String} message
 */
async function setLightTargetState(location, deviceId, message) {
  debug('Received set switch state '+message+' for switch Id: '+deviceId);
  debug('Location Id: '+ location.locationId);

  const command = message.toLowerCase();

  switch (command) {
    case 'on':
    case 'off':
      const devices = await location.getDevices();
      const device = devices.find((device) => device.id === deviceId);
      if (!device) {
        debug('Cannot find specified device id in location devices');
        break;
      }
      device.setInfo({device: {v1: {on: command === 'on' ? true : false}}});
      break;
    default:
      debug('Received invalid command for light!');
  }
}

/**
 * Set light switch target state on received MQTT command message
 * @param {Object} location
 * @param {String} deviceId
 * @param {String} message
 */
async function setLightTargetBrightness(location, deviceId, message) {
  debug('Received set switch state '+message+' for switch Id: '+deviceId);
  debug('Location Id: '+ location.locationId);

  const devices = await location.getDevices();
  const device = devices.find((device) => device.id === deviceId);
  if (!device) {
    debug('Cannot find specified device id in location devices');
  }
  device.setInfo({device: {v1: {level: message}}});
}

/**
 * Process received MQTT command
 * @param {String} topic
 * @param {String} message
 */
async function processCommand(topic, message) {
  const normalizedMessage = message.toString();
  if (topic === hassTopic) {
    // Republish devices and state after 60 seconds if restart of HA is detected
    debug('Home Assistant state topic '+topic+' received message: '+normalizedMessage);
    if (normalizedMessage == 'online') {
      debug('Resending device config/state in 30 seconds');
      // Make sure any existing republish dies
      republishCount = 0;
      await sleep(republishDelay+5);
      // Reset republish counter and start publishing config/state
      republishCount = 10;
      processLocations(ringLocations);
      debug('Resent device config/state information');
    }
  } else {
    const topicParts = topic.split('/');
    // Parse topic to get alarm/component/device info
    // TODO: this can be better
    const locationId = topicParts[topicParts.length - 5];
    const component = topicParts[topicParts.length - 3];
    const deviceId = topicParts[topicParts.length - 2];
    const commandType = topicParts[topicParts.length - 1];

    // Get alarm by location ID
    const location = await ringLocations.find((location) => location.locationId == locationId);

    switch (component) {
      case 'alarm_control_panel':
        setAlarmMode(location, deviceId, message);
        break;
      case 'lock':
        setLockTargetState(location, deviceId, message);
        break;
      case 'light':
        if (commandType === 'command') {
          setLightTargetState(location, deviceId, message);
        } else if (commandType === 'brightness') {
          setLightTargetBrightness(location, deviceId, (message / 255));
        }// TODO: other else case
        break;
      default:
        debug('Somehow received command for an unknown device!');
    }
  }
}

/**
 * Start MQTT Connection
 * @return {MqttClient}
 */
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

// Main code loop
const main = async () => {
  let locationIds = null;

  // Get Configuration from file
  try {
    CONFIG = require('./config');
    ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring';
    hassTopic = CONFIG.hass_topic;
    if (!(CONFIG.location_ids === undefined || CONFIG.location_ids == 0)) {
      locationIds = CONFIG.location_ids;
    }
  } catch (e) {
    debugError(e);
    try {
      debugError('Configuration file not found, try environment variables!');
      CONFIG = {
        'host': process.env.MQTTHOST,
        'port': process.env.MQTTPORT,
        'ring_topic': process.env.MQTTRINGTOPIC,
        'hass_topic': process.env.MQTTHASSTOPIC,
        'mqtt_user': process.env.MQTTUSER,
        'mqtt_pass': process.env.MQTTPASSWORD,
        'ring_user': process.env.RINGUSER,
        'ring_pass': process.env.RINGPASS,
      };
      ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring';
      hassTopic = CONFIG.hass_topic;
      if (!(CONFIG.ring_user || CONFIG.ring_pass)) throw new Error('Required environment variables are not set!');
    } catch (ex) {
      debugError(ex);
      console.error('Configuration file not found and required environment variables are not set!');
      process.exit(1);
    }
  }

  // Establish connection to Ring API
  try {
    debug({
      email: CONFIG.ring_user,
      password: CONFIG.ring_pass,
      locationIds: locationIds,
    });
    const ringApi = new RingApi({
      email: CONFIG.ring_user,
      password: CONFIG.ring_pass,
      locationIds: locationIds,
    });
    ringLocations = await ringApi.getLocations();
  } catch (error) {
    debugError(error);
    debugError(colors.red('Couldn\'t create the API instance. This could be because ring.com changed their API again'));
    debugError(colors.red('or maybe the password is wrong. Please check settings and try again.'));
    process.exit(1);
  }

  // Initiate connection to MQTT broker
  try {
    mqttClient = await initMqtt();
    mqttConnected = true;
    if (hassTopic) {
      mqttClient.subscribe(hassTopic);
    }
    debugMqtt('Connection established with MQTT broker, sending config/state information in 5 seconds.');
  } catch (error) {
    debugError(error);
    debugError(colors.red('Couldn\'t connect to MQTT broker. Please check the broker and configuration settings.'));
    process.exit(1);
  }

  // On MQTT connect/reconnect send config/state information after delay
  mqttClient.on('connect', async function() {
    if (!mqttConnected) {
      mqttConnected = true;
      debugMqtt('MQTT connection reestablished, resending config/state information in 5 seconds.');
    }
    await sleep(5);
    processLocations(ringLocations);
  });

  mqttClient.on('reconnect', function() {
    if (mqttConnected) {
      debugMqtt('Connection to MQTT broker lost. Attempting to reconnect...');
    } else {
      debugMqtt('Attempting to reconnect to MQTT broker...');
    }
    mqttConnected = false;
  });

  mqttClient.on('error', function(error) {
    debugMqtt('Unable to connect to MQTT broker.', error.message);
    mqttConnected = false;
  });

  // Process MQTT messages from subscribed command topics
  mqttClient.on('message', async function(topic, message) {
    processCommand(topic, message);
  });
};

// Call the main code
main();
