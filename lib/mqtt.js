const mqttApi = require('mqtt')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')

class Mqtt {
    constructor() {
        this.connected = false
    }

    async init(ring, config) {
        this.ring = ring
        // Initiate connection to MQTT broker
        try {
            debug('Starting connection to MQTT broker...')
            this.client = await this.connect(config)
            if (this.client.connected) {
                this.updateMqttState(true)
                debug('MQTT connection established, sending config/state information in 5 seconds.')
            }
            // Monitor configured/default Home Assistant status topic
            this.client.subscribe(config.hass_topic)
            // Monitor legacy Home Assistant status topics
            this.client.subscribe('hass/status')
            this.client.subscribe('hassio/status')
            this.start(config)
        } catch (error) {
            debug(error)
            debug(colors.red(`Could not authenticate to MQTT broker. Please check the broker and configuration settings.`))
            process.exit(1)
        }
    }

    // Initiate the connection to MQTT broker
    connect(config) {
        const mqtt_user = config.mqtt_user ? config.mqtt_user : null
        const mqtt_pass = config.mqtt_pass ? config.mqtt_pass : null
        const mqtt = mqttApi.connect({
            host: config.host,
            port: config.port,
            username: mqtt_user,
            password: mqtt_pass
        });
        return mqtt
    }

    // MQTT initialization successful, setup actions for MQTT events
    start(config) {
        const mqtt = this
        // On MQTT connect/reconnect send config/state information after delay
        this.client.on('connect', async function () {
            if (!mqtt.connected) {
                mqtt.updateMqttState(true)
                debug('MQTT connection established, processing locations...')
            }
            mqtt.ring.processLocations(mqtt.client)
        })

        this.client.on('reconnect', function () {
            if (mqtt.connected) {
                debug('Connection to MQTT broker lost. Attempting to reconnect...')
            } else {
                debug('Attempting to reconnect to MQTT broker...')
            }
            mqtt.updateMqttState(false)
        })

        this.client.on('error', function (error) {
            debug('Unable to connect to MQTT broker.', error.message)
            mqtt.updateMqttState(false)
        })

        // Process MQTT messages from subscribed command topics
        this.client.on('message', async function (topic, message) {
            mqtt.processMessage(topic, message, config)
        })
    }

    // Process received MQTT command
    async processMessage(topic, message, config) {
        message = message.toString()
        if (topic === config.hass_topic || topic === 'hass/status' || topic === 'hassio/status') {
            debug(`Home Assistant state topic ${topic} received message: ${message}`)
            if (message === 'online') {
                this.ring.republishDevices(this.client)
            }
        } else {
            this.ring.processDeviceCommand(topic, message)
        }
    }

    updateMqttState(state) {
        this.connected = state
        this.ring.updateMqttState(state)
    }
}

module.exports = new Mqtt()