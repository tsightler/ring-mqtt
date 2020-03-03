const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')

class Fan extends AlarmDevice {
    async init(mqttClient) {
        // Home Assistant component type and device class (set appropriate icon)
        this.component = 'fan'

        // Build required MQTT topics for device
        this.deviceTopic = this.alarmTopic+'/'+this.component+'/'+this.deviceId
        this.stateTopic = this.deviceTopic+'/fan_state'
        this.commandTopic = this.deviceTopic+'/fan_command'
        this.speedStateTopic = this.deviceTopic+'/fan_speed_state'
        this.speedCommandTopic = this.deviceTopic+'/fan_speed_command'
        this.attributesTopic = this.deviceTopic+'/attributes'
        this.availabilityTopic = this.deviceTopic+'/status'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'
        this.prevFanState = undefined
        this.targetFanLevel = undefined

        // Publish discovery message for HA and wait 2 seoonds before sending state
        this.publishDiscovery(mqttClient)
        await utils.sleep(2)

        // Publish device state data with optional subscribe
        this.publishSubscribeDevice(mqttClient)
    }

    publishDiscovery(mqttClient) {
        // Build the MQTT discovery message
        const message = {
            name: this.device.name,
            unique_id: this.deviceId,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: this.stateTopic,
            json_attributes_topic: this.attributesTopic,
            command_topic: this.commandTopic,
            speed_state_topic: this.speedStateTopic,
            speed_command_topic: this.speedCommandTopic,
            speeds: [ "low", "medium", "high" ]
        }

        debug('HASS config topic: '+this.configTopic)
        debug(message)
        this.publishMqtt(mqttClient, this.configTopic, JSON.stringify(message))
        mqttClient.subscribe(this.commandTopic)
        mqttClient.subscribe(this.speedCommandTopic)
    }

    publishData(mqttClient) {
        const fanState = this.device.data.on ? "ON" : "OFF"
        const fanSpeed = (this.device.data.level && !isNaN(this.device.data.level) ? this.device.data.level : 0)
        let fanLevel = "unknown"
        if (0 <= fanSpeed && fanSpeed <= 0.33) {
            fanLevel = 'low'
        } else if (0.33 <= fanSpeed && fanSpeed <= 0.67) {
            fanLevel = 'medium'
        } else if (0.67 <= fanSpeed && fanSpeed <= 1) {
            fanLevel = 'high'
        } else {
            debug('ERROR - Could not determine fan speed.  Raw value: '+fanSpeed)
        }
        
        // Publish device state
        // targetFanLevel is a hack to work around Home Assistant UI behavior
        if (this.targetFanLevel && this.targetFanLevel != fanLevel) {
            this.publishMqtt(mqttClient, this.speedStateTopic, this.targetFanLevel, true)
        } else {
            this.publishMqtt(mqttClient, this.speedStateTopic, fanLevel, true)
        }
        this.publishMqtt(mqttClient, this.stateTopic, fanState, true)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes(mqttClient)
    }
    
    // Process messages from MQTT command topic
    processCommand(message, cmdTopicLevel) {
        if (cmdTopicLevel == 'fan_command') {
            this.setFanState(message)
        } else if (cmdTopicLevel == 'fan_speed_command') {
            this.setFanLevel(message)
        } else {
            debug('Somehow received unknown command topic level '+cmdTopicLevel+' for fan Id: '+this.deviceId)
        }
    }

    // Set fan target state from received MQTT command message
    setFanState(message) {
        debug('Received set fan state '+message+' for fan Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)

        const command = message.toLowerCase()

        switch(command) {
            case 'on':
            case 'off':
                const on = (command === 'on') ? true : false
                this.device.setInfo({ device: { v1: { on } } })
                break;
            default:
                debug('Received invalid command for fan!')
        }
    }

    // Set fan speed state from received MQTT command message
    async setFanLevel(message) {
        let level = undefined
        debug('Received set fan to '+message+' for fan Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        switch(message.toLowerCase()) {
            case 'low':
                level = 0.33
                break;
            case 'medium':
                level = 0.67
                break;
            case 'high':
                level = 1
                break;
            default:
                debug('Speed command received but out of range (low,medium,high)!')
        }

        if (level) {
            debug('Set fan level to: '+level*100+'%')
            this.device.setInfo({ device: { v1: { level: level } } })
            this.targetFanLevel = message.toLowerCase()

            // Automatically turn on fan when level is sent.
            // Home assistant normally does this but we want the
            // same behavior for non-HA users as well.
            await utils.sleep(1)
            const fanState = this.device.data.on ? "ON" : "OFF"
            if (fanState == 'OFF') { this.setFanState('on') }
        }
    }
}

module.exports = Fan
