const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const writeFileAtomic = require('write-file-atomic')
const url = require('url')

class Config {
    constructor() {
        this.data = new Object()
        process.env.RUNMODE = process.env.hasOwnProperty('RUNMODE') ? process.env.RUNMODE : 'standard'
        debug(`Detected runmode: ${process.env.RUNMODE}`)
        switch (process.env.RUNMODE) {
            case 'docker':
                this.file = '/data/config.json'
                if (fs.existsSync(this.file)) {
                    this.loadConfigFile()
                } else {
                    // Configure using legacy environment variables
                    this.loadConfigEnv()
                }
                break;
            case 'addon':
                this.file = '/data/options.json'
                this.loadConfigFile()
                this.doMqttDiscovery()
                break;
            default:
                const configPath = require('path').dirname(require.main.filename)
                this.file = (process.env.RINGMQTT_CONFIG) ? configPath+process.env.RINGMQTT_CONFIG : configPath+'/config.json'  
                this.loadConfigFile()
        }

        // If there's still no configured settings, force some defaults.
        this.data.ring_topic = this.data.ring_topic ? this.data.ring_topic : 'ring'
        this.data.hass_topic = this.data.hass_topic ? this.data.hass_topic : 'homeassistant/status'
        this.data.enabled_cameras = this.data.hasOwnProperty('enable_cameras') ? this.data.enable_cameras : false
        this.data.enable_modes = this.data.hasOwnProperty('enable_modes') ? this.data.enable_modes : false
        this.data.enable_panic = this.data.hasOwnProperty('enable_panic') ? this.data.enable_panic : false
        this.data.disarm_code = this.data.hasOwnProperty('disarm_code') ? this.data.disarm_code : ''

        // If there's a legacy configuration, migrate to MQTT url based configuration
        if (!this.data.mqtt_url) {
            this.migrateToMqttUrl()
            this.updateConfigFile()
        }
        const mqttURL = new URL(this.data.mqtt_url)
        debug(`MQTT URL: ${mqttURL.protocol}//${mqttURL.username ? mqttURL.username+':********@' : ''}${mqttURL.hostname}:${mqttURL.port}`)
    }

    // Create CONFIG object from file or envrionment variables
    loadConfigFile() {
        debug('Configuration file: '+this.file)
        try {
            this.data = require(this.file)

            
        } catch (err) {
            debug(err.message)
            debug(colors.red('Configuration file could not be read, check that it exist and is valid.'))
            process.exit(1)
        }
    }

    doMqttDiscovery() {
        // Only required for legacy configuration when used with BRANCH feature
        // Can be removed on release of 5.x
        if (!this.data.mqtt_url) {
            this.data.mqtt_user = this.data.mqtt_user === '<auto_detect>' ? 'auto_username' : this.data.mqtt_user
            this.data.mqtt_password = this.data.mqtt_password === '<auto_detect>' ? 'auto_password' : this.data.mqtt_password
            this.data.mqtt_host = this.data.mqtt_host === '<auto_detect>' ? 'auto_hostname' : this.data.mqtt_host
            this.data.mqtt_port = this.data.mqtt_port === '<auto_detect>' ? '1883' : this.data.mqtt_port
            this.data.mqtt_url = `${this.data.mqtt_port === '8883' ? 'mqtts' : 'mqtt'}://${this.data.mqtt_user}:${this.data.mqtt_password}@${this.data.mqtt_host}:${this.data.mqtt_port}`
            delete this.data.mqtt_user
            delete this.data.mqtt_password
            delete this.data.mqtt_host
            delete this.data.mqtt_port
        }

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
            debug(colors.red('MQTT URL could not be parsed, please verify that it is in a valid format.'))
            process.exit(1)
        }
    }
 
    async loadConfigEnv() {
        debug(colors.yellow('No config file found, attempting to use environment variables for configuration'))
        debug(colors.yellow('******************************** IMPORTANT NOTE ********************************'))
        debug(colors.yellow('The use of environment variables for configuration is deprecated, and will be'))
        debug(colors.yellow('removed in a future release. Current settings will automatically be migrated to'))
        debug(colors.yellow(`${this.file} and this configuration will be used during future initializations.`))
        debug(colors.yellow('Please make sure you have configured a persistent volume mapping as this is now'))
        debug(colors.yellow('a requirement for all Docker based installations.'))
        this.data = {
            "host": process.env.MQTTHOST ? process.env.MQTTHOST : 'localhost',
            "port": process.env.MQTTPORT ? process.env.MQTTPORT : '1883',
            "mqtt_user": process.env.MQTTUSER,
            "mqtt_pass": process.env.MQTTPASSWORD,
            "ring_topic": process.env.MQTTRINGTOPIC,
            "hass_topic": process.env.MQTTHASSTOPIC,
            "disarm_code": process.env.DISARMCODE,
            "enable_cameras": process.env.ENABLECAMERAS,
            "livestream_user": process.env.LIVESTREAMUSER,
            "livestream_pass": process.env.LIVESTREAMPASSWORD,
            "enable_modes": process.env.ENABLEMODES,
            "enable_panic": process.env.ENABLEPANIC,
            "location_ids": process.env.RINGLOCATIONIDS
        }
        if (this.data.location_ids) { this.data.location_ids = this.data.location_ids.split(',') }
    }

    async updateConfigFile() {
        try {
            // Delete any legacy configuration options
            delete this.data.ring_token
            delete this.data.beam_duration
            delete this.data.snapshot_mode

            await writeFileAtomic(this.file, JSON.stringify(this.data, null, 4))
            debug('Successfully saved updated config file: '+this.file)
        } catch (err) {
            debug('Failed to save updated config file: '+this.file)
            debug(err.message)
        }
    }

    migrateToMqttUrl() {
        debug ('Migrating legacy MQTT config options to mqtt_url...')
        const mqttURL = new URL('mqtt://localhost')
        mqttURL.protocol = this.data.port == 8883 ? 'mqtts:' : 'mqtt:'
        mqttURL.hostname = this.data.host
        mqttURL.port = this.data.port
        mqttURL.username = this.data.mqtt_user ? this.data.mqtt_user : ''
        mqttURL.password = this.data.mqtt_pass ? this.data.mqtt_pass : ''
        delete this.data.host
        delete this.data.port
        delete this.data.mqtt_user
        delete this.data.mqtt_pass
        this.data = {mqtt_url: mqttURL.href, mqtt_options: '', ...this.data}
    }
}

module.exports = new Config()