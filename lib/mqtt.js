const mqttApi = require('mqtt')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils')

class Mqtt {
    constructor() {
        this.client = false
        this.connected = false

        // Configure event listeners
        utils.event.on('ring_state', async (state) => {
            if (!this.client && state === 'connected') {
                // Ring API connected, short wait before starting MQTT client
                await utils.sleep(2)
                this.init()
            }
        })

        utils.event.on('mqtt_publish', (topic, message) => {
            this.client.publish(topic, (typeof message === 'number') ? message.toString() : message, { qos: 1 })
        })

        utils.event.on('mqtt_subscribe', (topic) => {
            this.client.subscribe(topic)
        })
    }

    async init() {
        try {
            debug('Attempting connection to MQTT broker...')
            this.client = await this.connect()
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

    // Initiate the connection to MQTT broker
    async connect() {
        const mqttClient = await mqttApi.connect(utils.config.mqtt_url, {});
        return mqttClient
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

        // Process MQTT messages from subscribed command topics
        this.client.on('message', (topic, message) => {
            message = message.toString()
            if (topic === utils.config.hass_topic || topic === 'hass/status' || topic === 'hassio/status') {
                utils.event.emit('ha_status', topic, message)
            } else {
                utils.event.emit(topic, topic.split("/").slice(-2).join("/"), message)
            }
        })
    }
}

module.exports = new Mqtt()