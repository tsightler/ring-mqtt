const mqttApi = require ('mqtt')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')

const clientId = process.argv[2]
const stateTopic = process.argv[3]
const commandTopic = process.argv[4]
var mqttConnected = false
var streamStarted = false

// Setup Exit Handwlers
// process.on('exit', processExit.bind(null, 0))
process.on('SIGINT', processExit.bind(null, 0))
process.on('SIGTERM', processExit.bind(null, 0))
process.on('uncaughtException', function(err) {
    debug(colors.red('ERROR - Uncaught Exception'))
    console.log(colors.red(err))
    processExit(2)
})
process.on('unhandledRejection', function(err) {
    debug(colors.yellow('WARNING - Unhandled Promise Rejection'))
    console.log(colors.yellow(err))
})

// Set offline status on exit
async function processExit(exitCode) {
    if (streamStarted) {
        mqttClient.publish(commandTopic, 'OFF', { qos: 1 })
    }
    if (exitCode || exitCode === 0) debug(`Exit code: ${exitCode}`);
    debug('We are outta here!!!')
    process.exit()
}

const mqttClient = mqttApi.connect({
    host:process.env.MQTTHOST,
    port:process.env.MQTTPORT,
    username: process.env.MQTTUSER,
    password: process.env.MQTTPASSWORD,
    clientId,
    clean: false
});

// On MQTT connect/reconnect send config/state information after delay
mqttClient.on('connect', async function () {
    if (!mqttConnected) {
        mqttConnected = true
        debug('MQTT connection established, sending command to start live stream...')
    }
    debug('Subscribing to: '+stateTopic)
    mqttClient.subscribe(stateTopic, { qos: 1 })
    debug('Starting stream via publish to: '+commandTopic)
    mqttClient.publish(commandTopic, 'ON', { qos: 1 })
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
mqttClient.on('message', function (topic, message) {
    message = message.toString()
    if (streamStarted && message.toLowerCase() === 'off') {
        debug('Received message '+message+'!  Time to go...')
        processExit(0)
    } else if (message.toLowerCase() === 'on') {
        debug('Received message '+message+'...the stream has started!')
        streamStarted = true
    }
})
