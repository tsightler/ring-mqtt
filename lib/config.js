class Config {
    constructor() {
        this.valid = false
        this.data = new Object()
        switch (process.env.RUNMODE) {
            case 'docker':
                this.file = '/data/config.json'
                this.runMode = 'docker'
                await this.loadConfigEnv()
                break;
            case 'addon':
                this.file = '/data/options.json'
                this.runMode = 'addon'
                await this.loadConfigFile()
                // For addon always set MQTT values from environment vs config
                this.data.host = process.env.MQTTHOST
                this.data.port = process.env.MQTTPORT
                this.data.mqtt_user = process.env.MQTTUSER
                this.data.mqtt_pass = process.env.MQTTPASSWORD
                break;
            default:
                this.file = './config.json'
                this.runMode = 'standard'
                await this.loadConfigFile()
        }

        // If there's still no configured settings, force some defaults.
        this.data.host = this.data.host ? this.data.host : 'localhost'
        this.data.port = this.data.port ? this.data.port : '1883'
        this.data.ring_topic = this.data.ring_topic ? this.data.ring_topic : 'ring'
        this.data.hass_topic = this.data.hass_topic ? this.data.hass_topic : 'homeassistant/status'
        if (!this.data.enable_cameras) { this.data.enable_cameras = false }
        if (!this.data.snapshot_mode) { this.data.snapshot_mode = 'disabled' }
        if (!this.data.enable_modes) { this.data.enable_modes = false }
        if (!this.data.enable_panic) { this.data.enable_panic = false }
        if (!this.data.beam_duration) { this.data.beams_duration = 0 }
        if (!this.data.disarm_code) { this.data.disarm_code = '' }
        
        // Make sure MQTT environment variables are set even if only using config file (standalone install)
        // (these are needed fo start_stream.sh to be able to connect to MQTT broker)
        process.env.MQTTHOST = this.data.host
        process.env.MQTTPORT = this.data.port
        process.env.MQTTUSER = this.data.mqtt_user
        process.env.MQTTPASSWORD = this.data.mqtt_pass

    }

    // Create CONFIG object from file or envrionment variables
    async loadConfigFile() {
        debug('Using configuration file: '+this.file)
        try {
            this.data = require(this.file)
            this.setDefaults()
            this.valid = true
        } catch (err) {
            debug('Configuration file not found or could not be parsed, please check the config!')
        }
    }
 
    async loadConfigEnv() {
        debug('Using environment variables for configuration')
        this.data = {
            "host": process.env.MQTTHOST,
            "port": process.env.MQTTPORT,
            "ring_topic": process.env.MQTTRINGTOPIC,
            "hass_topic": process.env.MQTTHASSTOPIC,
            "mqtt_user": process.env.MQTTUSER,
            "mqtt_pass": process.env.MQTTPASSWORD,
            "ring_token": process.env.RINGTOKEN,
            "disarm_code": process.env.DISARMCODE,
            "beam_duration": process.env.BEAMDURATION,
            "enable_cameras": process.env.ENABLECAMERAS,
            "snapshot_mode": process.env.SNAPSHOTMODE,
            "livestream_user": process.env.LIVESTREAMUSER,
            "livestream_pass": process.env.LIVESTREAMPASSWORD,
            "enable_modes": process.env.ENABLEMODES,
            "enable_panic": process.env.ENABLEPANIC,
            "location_ids": process.env.RINGLOCATIONIDS
        }
        if (this.data.enable_cameras && this.data.enable_cameras != 'true') { this.data.enable_cameras = false}
        if (this.data.location_ids) { this.data.location_ids = this.data.location_ids.split(',') }
     }
}

module.exports = new Config()