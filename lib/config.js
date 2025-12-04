import chalk from 'chalk'
import fs from 'fs'
import { readFile } from 'fs/promises'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import debugModule from 'debug'
import utils from './utils'
const debug = debugModule('ring-mqtt')

export default new class Config {
    constructor() {
        this.data = new Object()
        process.env.RUNMODE = process.env.hasOwnProperty('RUNMODE') ? process.env.RUNMODE : 'standard'
        debug(`Detected runmode: ${process.env.RUNMODE}`)
        this.init()
    }

    async init() {
        switch (process.env.RUNMODE) {
            case 'docker':
                this.file = utils.configFile()
                if (fs.existsSync(this.file)) {
                    await this.loadConfigFile()
                } else {
                    debug(chalk.red(`No configuration file found at ${this.file}`))
                    debug(chalk.red('Please map a persistent volume to this location and place a configuration file there.'))
                    process.exit(1)
                }
                break;
            case 'addon':
                this.file = '/data/options.json'
                await this.loadConfigFile()
                this.doMqttDiscovery()
                break;
            default: {
                const configPath = dirname(fileURLToPath(new URL('.', import.meta.url)))+'/'
                this.file = (process.env.RINGMQTT_CONFIG) ? configPath+process.env.RINGMQTT_CONFIG : configPath+'config.json'
                await this.loadConfigFile()
            }
        }

        // If there's still no configured settings, force some defaults.
        this.data.ring_topic = this.data.hasOwnProperty('ring_topic') ? this.data.ring_topic : 'ring'
        this.data.hass_topic = this.data.hasOwnProperty('hass_topic') ? this.data.hass_topic : 'homeassistant/status'
        this.data.enable_cameras = this.data.hasOwnProperty('enable_cameras') ? this.data.enable_cameras : true
        this.data.enable_modes = this.data.hasOwnProperty('enable_modes') ? this.data.enable_modes : false
        this.data.enable_panic = this.data.hasOwnProperty('enable_panic') ? this.data.enable_panic : false
        this.data.disarm_code = this.data.hasOwnProperty('disarm_code') ? this.data.disarm_code : ''

        const mqttURL = new URL(this.data.mqtt_url)
        debug(`MQTT URL: ${mqttURL.protocol}//${mqttURL.username ? mqttURL.username+':********@' : ''}${mqttURL.hostname}:${mqttURL.port}`)
    }

    // Create CONFIG object from file or envrionment variables
    async loadConfigFile() {
        debug('Configuration file: '+this.file)
        try {
            this.data = JSON.parse(await readFile(this.file))
        } catch (err) {
            debug(err.message)
            debug(chalk.red('Configuration file could not be read, check that it exist and is valid.'))
            process.exit(1)
        }
    }

    doMqttDiscovery() {
        try {
            // Parse the MQTT URL and resolve any auto configuration
            const mqttURL = new URL(this.data.mqtt_url)
            if (mqttURL.hostname === "auto_hostname") {
                if (mqttURL.protocol === 'mqtt:') {
                    if (process.env.HAMQTTHOST) {
                        mqttURL.hostname = process.env.HAMQTTHOST
                        if (mqttURL.hostname === 'localhost' || mqttURL.hostname === '127.0.0.1') {
                            debug(`Discovered invalid value for MQTT host: ${mqttURL.hostname}`)
                            debug('Overriding with default alias for Mosquitto MQTT addon')
                            mqttURL.hostname = 'core-mosquitto'
                        }
                    } else {
                        debug('No Home Assistant MQTT service found, using Home Assistant hostname as default')
                        mqttURL.hostname = process.env.HAHOSTNAME
                    }
                } else if (mqttURL.protocol === 'mqtts:') {
                    mqttURL.hostname = process.env.HAHOSTNAME
                }
                debug(`Discovered MQTT Host: ${mqttURL.hostname}`)
            } else {
                debug(`Configured MQTT Host: ${mqttURL.hostname}`)
            }

            if (!mqttURL.port) {
                mqttURL.port = mqttURL.protocol === 'mqtts:' ? '8883' : '1883'
                debug(`Discovered MQTT Port: ${mqttURL.port}`)
            } else {
                debug(`Configured MQTT Port: ${mqttURL.port}`)
            }

            if (mqttURL.username === 'auto_username') {
                mqttURL.username = process.env.HAMQTTUSER ? process.env.HAMQTTUSER : ''
                if (mqttURL.username) {
                    debug(`Discovered MQTT User: ${mqttURL.username}`)
                } else {
                    mqttURL.username = ''
                    debug('Using anonymous MQTT connection')
                }
            } else {
                debug(`Configured MQTT User: ${mqttURL.username}`)
            }

            if (mqttURL.username) {
                if (mqttURL.password === "auto_password") {
                    mqttURL.password = process.env.HAMQTTPASS ? process.env.HAMQTTPASS : ''
                    if (mqttURL.password) {
                        debug('Discovered MQTT password: <hidden>')
                    }
                } else {
                    debug('Configured MQTT password: <hidden>')
                }
            }

            this.data.mqtt_url = mqttURL.href
        } catch (err) {
            debug(err.message)
            debug(chalk.red('MQTT URL could not be parsed, please verify that it is in a valid format.'))
            process.exit(1)
        }
    }
}
