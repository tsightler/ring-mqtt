const mqttApi = require('mqtt')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils')
const fs = require('fs')
const parseArgs = require('minimist')
const mqttServer = require('aedes')()
const net = require('net')

class Mqtt {
    constructor() {
        this.client = false
        this.ipcClient = false
        this.connected = false

        // Start internal broker, used only for inter-process communication (IPC)
        net.createServer(mqttServer.handle)
        net.listen(51883, '127.0.0.1')

        // Configure event listeners
        utils.event.on('ring_api_state', async (state) => {
            if (!this.client && state === 'connected') {
                // Ring API connected, short wait before starting MQTT client
                await utils.sleep(2)
                this.init()
            }
        })

        // Handle client MQTT broker events
        utils.event.on('mqtt_publish', (topic, message) => {
            this.client.publish(topic, (typeof message === 'number') ? message.toString() : message, { qos: 1 })
        })

        utils.event.on('mqtt_subscribe', (topic) => {
            this.client.subscribe(topic)
        })

        // Handle IPC broker events
        utils.event.on('mqtt_ipc_publish', (topic, message) => {
            this.ipcClient.publish(topic, (typeof message === 'number') ? message.toString() : message, { qos: 1 })
        })

        utils.event.on('mqtt_ipc_subscribe', (topic) => {
            this.ipcClient.subscribe(topic)
        })

    }

    async init() {
        try {
            let mqttOptions = utils.config.mqtt_options ? parseArgs(utils.config.mqtt_options) : {}
            console.log(mqttOptions)
            if (Object.keys(mqttOptions).length > 0) {
                // If any of the cerficiate keys are in mqtt_options, read the data from the file
                try {
                    if (utils.config.mqtt_options.hasOwnProperty('key')) {
                        utils.config.mqtt_options.key = fs.readFileSync(utils.config.mqtt_options.key)
                    }
                    if (utils.config.mqtt_options.hasOwnProperty('cert')) {
                        utils.config.mqtt_options.cert = fs.readFileSync(utils.config.mqtt_options.cert)
                    }
                    if (utils.config.mqtt_options.hasOwnProperty('ca')) {
                        utils.config.mqtt_options.ca = fs.readFileSync(utils.config.mqtt_options.ca)
                    }
                } catch(err) {
                    debug(colors.yellow('Could not parse MQTT advanced options, continuing with default settings'))
                }
            }
            debug('Attempting connection to MQTT broker...')

            // Connect to client facing MQTT broker
            console.log(utils.config.mqtt_options)
            this.client = await mqttApi.connect(utils.config.mqtt_url, utils.config.mqtt_options);

            // Connect to internal IPC broker
            this.ipcClient = await mqttApi.connect('mqtt://127.0.0.1:51883', {})

            this.start()

            // Subscribe to configured/default/legacay Home Assistant status topics
            this.client.subscribe(utils.config.hass_topic)
            this.client.subscribe('hass/status')
            this.client.subscribe('hassio/status')
        } catch (error) {
            debug(error)
            debug(colors.red(`Could not authenticate to MQTT broker. Please check the broker and configuration settings.`))
            process.exit(1)
        }
    }

    start() {
        // On MQTT connect/reconnect send config/state information after delay
        this.client.on('connect', () => {
            if (!this.connected) {
                this.connected = true
                utils.event.emit('mqtt_state', 'connected')
            }
        })

        this.client.on('reconnect', () => {
            if (this.connected) {
                debug('Connection to MQTT broker lost. Attempting to reconnect...')
            } else {
                debug('Attempting to reconnect to MQTT broker...')
            }
            this.connected = false
            utils.event.emit('mqtt_state', 'disconnected')
        })

        this.client.on('error', (error) => {
            debug('Unable to connect to MQTT broker', error.message)
            this.connected = false
            utils.event.emit('mqtt_state', 'disconnected')
        })

        // Process subscribed MQTT messages from subscribed command topics
        this.client.on('message', (topic, message) => {
            message = message.toString()
            if (topic === utils.config.hass_topic || topic === 'hass/status' || topic === 'hassio/status') {
                utils.event.emit('ha_status', topic, message)
            } else {
                utils.event.emit(topic, topic.split("/").slice(-2).join("/"), message)
            }
        })

        // Process MQTT messages from the IPC broker
        this.ipcClient.on('message', (topic, message) => {
            message = message.toString()
            utils.event.emit(topic, topic.split("/").slice(-2).join("/"), message)
        })
    }
}

module.exports = new Mqtt()