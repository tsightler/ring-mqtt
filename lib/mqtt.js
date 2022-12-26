const mqttApi = require('mqtt')
const debug = require('debug')('ring-mqtt')
const debugRtsp = require('debug')('ring-rtsp')
const colors = require('colors/safe')
const utils = require('./utils')
const fs = require('fs')
const parseArgs = require('minimist')
const aedes = require('aedes')()
const net = require('net')

class Mqtt {
    constructor() {
        this.client = false
        this.ipcClient = false
        this.connected = false

        // Start internal broker, used only for inter-process communication (IPC)
        const mqttServer = net.createServer(aedes.handle)
        mqttServer.listen(51883, '127.0.0.1')

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
            let mqttOptions = {}
            if (utils.config.mqtt_options) {
                // If any of the cerficiate keys are in mqtt_options, read the data from the file
                try {
                    const mqttConfigOptions = parseArgs(utils.config.mqtt_options.split(','))
                    Object.keys(mqttConfigOptions).forEach(key => {
                        switch (key) {
                            // For any of the file based options read the file into the option property
                            case 'key':
                            case 'cert':
                            case 'ca':
                            case 'pfx':
                                mqttConfigOptions[key] = fs.readFileSync(mqttConfigOptions[key])
                                break;
                            case '_':
                                delete mqttConfigOptions[key]
                                break;
                            default:
                                // Convert any string true/false values to boolean equivalent
                                mqttConfigOptions[key] = (mqttConfigOptions[key] === 'true') ? true : mqttConfigOptions[key]
                                mqttConfigOptions[key] = (mqttConfigOptions[key] === 'false') ? false : mqttConfigOptions[key]
                        }
                    })
                    mqttOptions = mqttConfigOptions
                } catch(err) {
                    debug(err)
                    debug(colors.yellow('Could not parse MQTT advanced options, continuing with default settings'))
                }
            }
            debug('Attempting connection to MQTT broker...')

            // Connect to client facing MQTT broker
            this.client = await mqttApi.connect(utils.config.mqtt_url, mqttOptions);

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
            utils.event.emit(topic, topic.split("/").slice(-2).join("/"), message.toString())
        })
    }
}

module.exports = new Mqtt()