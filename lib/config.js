const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const writeFileAtomic = require('write-file-atomic')

class Config {
    constructor() {
        this.valid = false
        this.data = new Object()
        process.env.RUNMODE = process.env.hasOwnProperty('RUNMODE') ? process.env.RUNMODE : 'standard'
        debug(`Detected runmode: ${process.env.RUNMODE}`)
        switch (process.env.RUNMODE) {
            case 'docker':
                this.file = '/data/config.json'
                if (fs.existsSync(this.file)) {
                    this.loadConfigFile()
                    if (!this.data.mqtt_url) {
                        this.migrateToMqttUrl()
                    }
                } else {
                    // Configure using legacy environment variables
                    this.loadConfigEnv()
                    // Save config file for future startups
                    this.updateConfig()
                }
                break;
            case 'addon':
                this.file = '/data/options.json'
                this.loadConfigFile()
                if (!this.data.mqtt_url || this.data.mqtt_url === '<auto_detect>') {
                    this.data.mqtt_url = process.env.MQTTURL
                }
                break;
            default:
                if (process.env.CONFIG) {
                    this.file = require('path').dirname(require.main.filename)+'/'+process.env.CONFIG
                } else {
                    this.file = require('path').dirname(require.main.filename)+'/config.json'
                }
                this.loadConfigFile()
                if (!this.data.mqtt_url) {
                    this.migrateToMqttUrl()
                }
        }

        // If there's still no configured settings, force some defaults.
        this.data.ring_topic = this.data.ring_topic ? this.data.ring_topic : 'ring'
        this.data.hass_topic = this.data.hass_topic ? this.data.hass_topic : 'homeassistant/status'
        if (!this.data.enable_cameras) { this.data.enable_cameras = false }
        if (!this.data.enable_modes) { this.data.enable_modes = false }
        if (!this.data.enable_panic) { this.data.enable_panic = false }
        if (!this.data.beam_duration) { this.data.beam_duration = 0 }
        if (!this.data.disarm_code) { this.data.disarm_code = '' }
        
        // Export MQTTURL environment variable even if only using config file (standalone install)
        // This is needed for start_stream.sh to be able to connect to MQTT broker
        debug(`MQTT URL: ${this.data.mqtt_url.split('://')[0]}://${this.data.mqtt_url.split('://')[1].replace(/:.*@/, ':<hidden>@')}`)
        process.env.MQTTURL = this.data.mqtt_url
    }

    // Create CONFIG object from file or envrionment variables
    async loadConfigFile() {
        debug('Configuration file: '+this.file)
        try {
            this.data = require(this.file)
            this.valid = true
        } catch (err) {
            debug(err.message)
            debug('Configuration file could not be read, check that it exist and is valid.')
            process.exit(1)
        }
    }
 
    async loadConfigEnv() {
        debug('No config file found, attempting to use environment variables for configuration')
        debug(colors.yellow('********** IMPORTANT NOTE **********'))
        debug(colors.yellow('Use of environment variables for configuration is deprecated, and will be removed in'))
        debug(colors.yellow(`a future release. Current settings will automatically be migrated to ${this.file}`))
        debug(colors.yellow('and this file will be used for configuration settings during future startups.'))
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
            "beam_duration": process.env.BEAMDURATION,
            "enable_cameras": process.env.ENABLECAMERAS,
            "livestream_user": process.env.LIVESTREAMUSER,
            "livestream_pass": process.env.LIVESTREAMPASSWORD,
            "enable_modes": process.env.ENABLEMODES,
            "enable_panic": process.env.ENABLEPANIC,
            "location_ids": process.env.RINGLOCATIONIDS
        }
        if (this.data.enable_cameras && this.data.enable_cameras != 'true') { this.data.enable_cameras = false}
        if (this.data.location_ids) { this.data.location_ids = this.data.location_ids.split(',') }

        // Convert legacy configuration options to MQTT URL
        const mqttUrlPrefix = (this.data.port == 8883 || this.data.port == 8884) ? 'mqtts://' : 'mqtt://'
        let mqttUrl = `${mqttUrlPrefix}${this.data.host}:${this.data.port}`            
        if (this.data.mqtt_user && this.data.mqtt_pass) {
            mqttUrl = `${mqttUrlPrefix}${this.data.mqtt_user}:${this.data.mqtt_pass}@${this.data.host}:${this.data.port}`
        }
        delete this.data.host
        delete this.data.port
        delete this.data.mqtt_user
        delete this.data.mqtt_pass

        this.valid = true
     }

    migrateToMqttUrl() {
        debug ('Migrating legacy MQTT config options to mqtt_url...')
        const mqttUrlPrefix = (this.data.port == 8883 || this.data.port == 8884) ? 'mqtts://' : 'mqtt://'
        let mqttUrl = `${mqttUrlPrefix}${this.data.host}:${this.data.port}`            
        if (this.data.mqtt_user && this.data.mqtt_pass) {
            mqttUrl = `${mqttUrlPrefix}${this.data.mqtt_user}:${this.data.mqtt_pass}@${this.data.host}:${this.data.port}`
        }
        delete this.data.host
        delete this.data.port
        delete this.data.mqtt_user
        delete this.data.mqtt_pass
        this.data = {mqtt_url: mqttUrl, ...this.data}
        this.updateConfig()
    }

    async updateConfig() {
        try {
            delete this.data.ring_token
            await writeFileAtomic(this.file, JSON.stringify(this.data, null, 4))
            debug('Successfully saved updated config file: '+this.file)
        } catch (err) {
            debug('Failed to save updated config file: '+this.file)
            debug(err.message)
        }
    }
}

module.exports = new Config()