const mqttApi = require('mqtt')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils.js')

class Mqtt {
    constructor() {
        this.connected = false
    }

    async init(ring, config) {
        this.ring = ring
        this.config = config
        // Initiate connection to MQTT broker
        try {
            debug('Starting connection to MQTT broker...')
            this.client = await this.connect()
            if (this.client.connected) {
                this.connected = true
                debug('MQTT connection established, sending config/state information in 5 seconds.')
            }
            // Monitor configured/default Home Assistant status topic
            this.client.subscribe(this.config.hass_topic)
            // Monitor legacy Home Assistant status topics
            this.client.subscribe('hass/status')
            this.client.subscribe('hassio/status')
            this.start()
        } catch (error) {
            debug(error)
            debug(colors.red('Couldn\'t authenticate to MQTT broker. Please check the broker and configuration settings.'))
            process.exit(1)
        }
    }

    // Initiate the connection to MQTT broker
    connect() {
        const mqtt_user = this.config.mqtt_user ? this.config.mqtt_user : null
        const mqtt_pass = this.config.mqtt_pass ? this.config.mqtt_pass : null
        const mqtt = mqttApi.connect({
            host: this.config.host,
            port: this.config.port,
            username: mqtt_user,
            password: mqtt_pass
        });
        return mqtt
    }

    // MQTT initialization successful, setup actions for MQTT events
    start() {
        const mqtt = this
        // On MQTT connect/reconnect send config/state information after delay
        this.client.on('connect', async function () {
            if (!mqtt.connected) {
                mqtt.connected = true
                debug('MQTT connection established, processing locations...')
            }
            mqtt.ring.processLocations(mqtt)
        })

        this.client.on('reconnect', function () {
            if (mqtt.connected) {
                debug('Connection to MQTT broker lost. Attempting to reconnect...')
            } else {
                debug('Attempting to reconnect to MQTT broker...')
            }
            mqtt.connected = false
        })

        this.client.on('error', function (error) {
            debug('Unable to connect to MQTT broker.', error.message)
            mqtt.connected = false
        })

        // Process MQTT messages from subscribed command topics
        this.client.on('message', async function (topic, message) {
            mqtt.processMessage(topic, message)
        })
    }

    connected() {
        if (!this.connected) {
            this.connected = true
            debug('MQTT connection established, processing locations...')
        }
        this.ring.processLocations(this)
    }

    // Process received MQTT command
    async processMessage(topic, message) {
        message = message.toString()
        if (topic === this.config.hass_topic || topic === 'hass/status' || topic === 'hassio/status') {
            debug('Home Assistant state topic '+topic+' received message: '+message)
            if (message == 'online') {
                // Republish devices and state if restart of HA is detected
                if (this.republishCount > 0) {
                    debug('Home Assisntat restart detected during existing republish cycle')
                    debug('Resetting device config/state republish count')
                    this.republishCount = 6
                } else {
                    debug('Home Assistant restart detected, resending device config/state in 5 seconds')
                    await utils.sleep(5)
                    this.republishCount = 6
                    this.ring.processLocations(this)
                }
            }
        } else {
            // Parse topic to get location/device ID
            const ringTopicLevels = (this.config.ring_topic).split('/').length
            const splitTopic = topic.split('/')
            const locationId = splitTopic[ringTopicLevels]
            const deviceId = splitTopic[ringTopicLevels + 2]

            // Find existing device by matching location & device ID
            const cmdDevice = this.ring.devices.find(d => (d.deviceId == deviceId && d.locationId == locationId))

            if (cmdDevice) {
                const componentCommand = topic.split("/").slice(-2).join("/")
                cmdDevice.processCommand(message, componentCommand)
            } else {
                debug('Received MQTT message for device Id '+deviceId+' at location Id '+locationId+' but could not find matching device')
            }
        }
    }
}

module.exports = new Mqtt()