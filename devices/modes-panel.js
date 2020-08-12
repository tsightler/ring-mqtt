const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class ModesPanel extends AlarmDevice {
    // This is not a "real" device so constructor is a little different
    constructor(location, mqttClient, ringTopic) {
        this.location = location
        this.mqttClient = mqttClient
        this.locationId = this.location.locationId
        this.name = this.location.name+' Modes'
        this.deviceId = locationId+'_mode_switch'
        this.availabilityState = 'offline'
    }

    async init() {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'alarm_control_panel'
        
        // Build required MQTT topics for device
        this.deviceTopic = ringTopic+'/'+this.locationId+'/mode/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/mode_state'
        this.commandTopic = this.deviceTopic+'/made_command'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery()
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        if (this.subscribed) {
            this.publishSubscribeDevice()
        } else {
            this.location.onLocationMode.subscribe((mode) => {
                this.publishData()
            })
            this.subscribed = true
        }
        // Publish availability state for device
        this.online()
    }

    publishDiscovery() {
        // Build the MQTT discovery message
        const message = {
            name: this.name,
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            command_topic: this.commandTopic
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(this.configTopic, JSON.stringify(message))
        this.mqttClient.subscribe(this.commandTopic)
    }

    publishData() {
        let locationMode
        switch(mode) {
            case 'disarmed':
                locationMode = 'disarmed'
                break;
            case 'home':
                locationMode = 'armed_home'
                break;
            case 'away':
                locationMode = 'armed_away'
                break;
            default:
                locationMode = 'disarmed'
        }
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, locationMode, true)
    }
    
    // Process messages from MQTT command topic
    processCommand(message) {
        this.setLocationMode(message)
    }

    // Set Alarm Mode on received MQTT command message
    async setLocationMode(message) {
        debug('Received set mode command '+message+' for location ID: '+this.locationId)

        // Try to set alarm mode and retry after delay if mode set fails
        // Initial attempt with no delay
        let delay = 0
        let retries = 12
        let setModeSuccess = false
        while (retries-- > 0 && !(setModeSuccess)) {
            setModeSuccess = await this.trySetMode(message, delay)
            // On failure delay 10 seconds for next set attempt
            delay = 1
        }
        // Check the return status and print some debugging for failed states
        if (setModeSuccess == false ) {
            debug('Could not enter proper mode state after all retries...Giving up!')
        } else if (setModeSuccess == 'unknown') {
            debug('Ignoring unknown command.')
        }
    }

    async trySetMode(message, delay) {
        await utils.sleep(delay)
        let targetMode
        debug('Set location mode: '+message)
        switch(message) {
            case 'DISARM':
                targetMode = 'none'
                break
            case 'ARM_HOME':
                targetMode = 'home'
                break
            case 'ARM_AWAY':
                targetMode = 'away'
                break
            default:
                debug('Cannot set alarm mode: Unknown')
                return 'unknown'
        }
        this.location.setLocationMode(targetMode)

        // Sleep a few seconds and check if location entered the requested mode
        await utils.sleep(10);
        if (this.location.getLocationMode() == targetMode) {
            debug('Location successfully entered mode: '+message)
            return true
        } else {
            debug('Location failed to enter requested mode!')
            return false
        }
    }
}

module.exports = ModesPanel
