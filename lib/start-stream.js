const mqttApi = require ('mqtt')
const colors = require('colors/safe')
const utils = require('./utils')

const clientId = process.argv[2]
const stateTopic = process.argv[3]
const commandTopic = process.argv[4]

const pad = ' '.repeat(25)
var mqttConnected = false
var streamStarted = false

// Setup Exit Handwlers
// process.on('exit', processExit.bind(null, 0))
process.on('SIGINT', processExit.bind(null, 0))
process.on('SIGTERM', processExit.bind(null, 0))
process.on('uncaughtException', function(err) {
    console.log(pad+colors.red('ERROR - Uncaught Exception'))
    console.log(pad+colors.red(err))
    processExit(2)
})
process.on('unhandledRejection', function(err) {
    console.log(pad+colors.yellow('WARNING - Unhandled Promise Rejection'))
    console.log(pad+colors.yellow(err))
})

// Set offline status on exit
function processExit(exitCode) {
    if (streamStarted) {
        mqttClient.publish(commandTopic, 'OFF', { qos: 1 })
    }
    if (exitCode || exitCode === 0) console.log(pad+`Exit code: ${exitCode}`);
    process.exit()
}

const mqttClient = mqttApi.connect({
    host:process.env.MQTTHOST,
    port:process.env.MQTTPORT,
    username: process.env.MQTTUSER,
    password: process.env.MQTTPASSWORD,
    clientId,
    clean: true
});

// On MQTT connect/reconnect send config/state information after delay
mqttClient.on('connect', async function () {
    if (!mqttConnected) {
        mqttConnected = true
        console.log(pad+'MQTT connection established, sending command to start live stream...')
    }
    console.log(pad+'Subscribing to: '+stateTopic)
    mqttClient.subscribe(stateTopic, { qos: 1 })
    await utils.msleep(100)
    console.log(pad+'Starting stream via publish to: '+commandTopic)
    mqttClient.publish(commandTopic, 'ON', { qos: 1 })
})

mqttClient.on('reconnect', function () {
    if (mqttConnected) {
        console.log(pad+'Connection to MQTT broker lost. Attempting to reconnect...')
    } else {
        console.log(pad+'Attempting to reconnect to MQTT broker...')
    }
    mqttConnected = false
})

mqttClient.on('error', function (error) {
    console.log(pad+'Unable to connect to MQTT broker.', error.message)
    mqttConnected = false
})

// Process MQTT messages from subscribed command topics
mqttClient.on('message', function (topic, message) {
    message = message.toString()
    if (streamStarted && message.toLowerCase() === 'off') {
        console.log(pad+'Received message '+message+'!  Time to go...')
        processExit(0)
    } else if (message.toLowerCase() === 'on') {
        console.log(pad+'Received message '+message+'...the stream has started!')
        streamStarted = true
    }
})
