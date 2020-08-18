const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class SecurityPanel extends AlarmDevice {
    async publish(locationConnected) {
        // Online initialize if location websocket is connected
        if (!locationConnected) { return }

        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'alarm_control_panel'
        this.deviceData.mdl = 'Alarm Base Station'
        this.deviceData.name = this.device.location.name + ' Alarm'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/alarm_state'
        this.commandTopic = this.deviceTopic+'/alarm_command'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'

        // Publish discovery message
        if (!this.discoveryData.length) { await this.initDiscoveryData() }
        await this.publishDiscoveryData()

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice()

        // Subscribe to device command topic
        this.mqttClient.subscribe(this.commandTopic)
    }

    initDiscoveryData() {
        // Build the MQTT discovery message
        this.discoveryData.push({
            message: {
                name: this.device.location.name+' Alarm',
                unique_id: this.deviceId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic,
                json_attributes_topic: this.attributesTopic,
                command_topic: this.commandTopic,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })
    }

    publishData() {
        var alarmMode
        switch(this.device.data.mode) {
            case 'none':
                alarmMode = 'disarmed'
                break;
            case 'some':
                alarmMode = 'armed_home'
                break;
            case 'all':
                alarmMode = 'armed_away'
                break;
            default:
                alarmMode = 'unknown'
        }
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, alarmMode, true)
        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message) {
        this.setAlarmMode(message)
    }

    // Set Alarm Mode on received MQTT command message
    async setAlarmMode(message) {
        debug('Received set alarm mode '+message+' for Security Panel Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        // Try to set alarm mode and retry after delay if mode set fails
        // Initial attempt with no delay
        var delay = 0
        var retries = 12
        var setAlarmSuccess = false
        while (retries-- > 0 && !(setAlarmSuccess)) {
            setAlarmSuccess = await this.trySetAlarmMode(message, delay)
            // On failure delay 10 seconds for next set attempt
            delay = 10
        }
        // Check the return status and print some debugging for failed states
        if (setAlarmSuccess == false ) {
            debug('Device could not enter proper arming mode after all retries...Giving up!')
        } else if (setAlarmSuccess == 'unknown') {
            debug('Ignoring unknown command.')
        }
    }

    async trySetAlarmMode(message, delay) {
        await utils.sleep(delay)
        var alarmTargetMode
        debug('Set alarm mode: '+message)
        switch(message) {
            case 'DISARM':
                this.device.location.disarm().catch(err => { debug(err) })
                alarmTargetMode = 'none'
                break
            case 'ARM_HOME':
                this.device.location.armHome().catch(err => { debug(err) })
                alarmTargetMode = 'some'
                break
            case 'ARM_AWAY':
                this.device.location.armAway().catch(err => { debug(err) })
                alarmTargetMode = 'all'
                break
            default:
                debug('Cannot set alarm mode: Unknown')
                return 'unknown'
        }

        // Sleep a few seconds and check if alarm entered requested mode
        await utils.sleep(1);
        if (this.device.data.mode == alarmTargetMode) {
            debug('Alarm successfully entered mode: '+message)
            return true
        } else {
            debug('Device failed to enter requested arm/disarm mode!')
            return false
        }
    }
}

module.exports = SecurityPanel
