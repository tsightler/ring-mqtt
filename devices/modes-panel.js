const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const ModesDevice = require('./modes-device')

class ModesPanel extends ModesDevice {
    async init() {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'modes_control_panel'

        // Build required MQTT topics for device
        this.deviceTopic = this.modesTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/modes_state'
        this.commandTopic = this.deviceTopic+'/modes_command'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery()
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()
    }

    publishDiscovery() {
        // Build the MQTT discovery message
        const message = {
            name: this.device.name,
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            json_attributes_topic: this.attributesTopic,
            command_topic: this.commandTopic
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(this.configTopic, JSON.stringify(message))
        this.mqttClient.subscribe(this.commandTopic)
    }

    publishData() {
        var ringMode
        switch(this.device.data.mode) {
            case 'none':
                ringMode = 'disarmed'
                break;
            case 'some':
                ringMode = 'armed_home'
                break;
            case 'all':
                ringMode = 'armed_away'
                break;
            default:
                ringMode = 'unknown'
        }
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, ringMode, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message) {
        this.setringMode(message)
    }

    // Set Ring Mode on received MQTT command message
    async setringMode(message) {
        debug('Received set Ring mode '+message+' for Modes Panel Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        // Try to set Ring mode and retry after delay if mode set fails
        // Initial attempt with no delay
        var delay = 0
        var retries = 12
        var setModesSuccess = false
        while (retries-- > 0 && !(setModesSuccess)) {
            setModesSuccess = await this.trySetringMode(message, delay)
            // On failure delay 10 seconds for next set attempt
            delay = 10
        }
        // Check the return status and print some debugging for failed states
        if (setModesSuccess == false ) {
            debug('Device could not enter proper arming mode after all retries...Giving up!')
        } else if (setModesSuccess == 'unknown') {
            debug('Ignoring unknown command.')
        }
    }

    async trySetringMode(message, delay) {
        await utils.sleep(delay)
        var ringTargetMode
        debug('Set Ring mode: '+message)
        switch(message) {
            case 'DISARM':
                this.device.location.disarm().catch(err => { debug(err) })
                ringTargetMode = 'none'
                break
            case 'ARM_HOME':
                this.device.location.armHome().catch(err => { debug(err) })
                ringTargetMode = 'some'
                break
            case 'ARM_AWAY':
                this.device.location.armAway().catch(err => { debug(err) })
                ringTargetMode = 'all'
                break
            default:
                debug('Cannot set Ring mode: Unknown')
                return 'unknown'
        }

        // Sleep a few seconds and check if Ring entered requested mode
        await utils.sleep(2);
        if (this.device.data.mode == ringTargetMode) {
            debug('Ring successfully entered mode: '+message)
            return true
        } else {
            debug('Device failed to enter requested arm/disarm mode!')
            return false
        }
    }
}

module.exports = ModesPanel
