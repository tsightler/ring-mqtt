const utils = require( '../lib/utils' )
const RingSocketDevice = require('./base-socket-device')

class Fan extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm')
        this.deviceData.mdl = 'Fan Control'

        this.entity.fan = {
            component: 'fan',
            isLegacyEntity: true  // Legacy compatibility
        }

        this.data = {
            targetFanPercent: undefined
        }
    }

    publishData() {
        const fanState = this.device.data.on ? "ON" : "OFF"
        const fanPercent = (this.device.data.level && !isNaN(this.device.data.level) ? Math.round(this.device.data.level*100) : 0)
        let fanPreset = "unknown"
        if (fanPercent > 67) {
            fanPreset = 'high'
        } else if (fanPercent > 33) {
            fanPreset = 'medium'
        } else if (fanPercent >= 0) {
            fanPreset = 'low'
        } else {
            this.debug(`ERROR - Could not determine fan preset value.  Raw percent value: ${fanPercent}%`)
        }
        
        // Publish device state
        // targetFanPercent is a small hack to work around Home Assistant UI behavior
        if (this.data.targetFanPercent && this.data.targetFanPercent !== fanPercent) {
            this.mqttPublish(this.entity.fan.percentage_state_topic, this.data.targetFanPercent.toString())
            this.data.targetFanPercent = undefined
        } else {
            this.mqttPublish(this.entity.fan.percentage_state_topic, fanPercent.toString())
        }
        this.mqttPublish(this.entity.fan.state_topic, fanState)
        this.mqttPublish(this.entity.fan.preset_mode_state_topic, fanPreset)

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'fan/command':
                this.setFanState(message)
                break;
            case 'fan/percent_speed_command':
                this.setFanPercent(message)
                break;
            case 'fan/speed_command':
                this.setFanPreset(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${componentCommand}`)
        }
    }

    // Set fan target state from received MQTT command message
    setFanState(message) {
        this.debug(`Received set fan state ${message}`)
        const command = message.toLowerCase()
        switch(command) {
            case 'on':
            case 'off':
                const on = (command === 'on') ? true : false
                this.device.setInfo({ device: { v1: { on } } })
                break;
            default:
                this.debug('Received invalid command for fan!')
        }
    }

    // Set fan speed based on percent
    async setFanPercent(message) {
        if (isNaN(message)) {
            this.debug('Fan speed percent command received but value is not a number')
            return
        }

        let setFanPercent = parseInt(message)

        if (setFanPercent === 0) {
            this.debug('Received fan speed of 0%, turning fan off')
            if (this.device.data.on) { this.setFanState('off') }
            return
        } else if (setFanPercent < 10) {
            this.debug(`Received fan speed of ${setFanPercent}% which is < 10%, overriding to 10%`)
            setFanPercent = 10 
        } else if (setFanPercent > 100) {
            this.debug(`Received fan speed of ${setFanPercent}% which is > 100%, overriding to 100%`)
            setFanPercent = 100
        }

        this.data.targetFanPercent = setFanPercent

        this.debug(`Setting fan speed percentage to ${this.data.targetFanPercent}%`)

        this.device.setInfo({ device: { v1: { level: this.data.targetFanPercent / 100 } } })
        // Automatically turn on fan when level is sent.
        await utils.sleep(1)
        if (!this.device.data.on) { this.setFanState('on') }
    }

    // Set fan speed state from received MQTT command message
    async setFanPreset(message) {
        let fanPercent
        switch(message.toLowerCase()) {
            case 'low':
                fanPercent = 33
                break;
            case 'medium':
                fanPercent = 67
                break;
            case 'high':
                fanPercent = 100
                break;
            default:
                this.debug(`Received invalid fan preset command ${message.toLowerCase()}`)
        }

        if (fanPercent) {
            this.debug(`Received set fan preset to ${message.toLowerCase()}`)
            this.setFanPercent(fanPercent)
        }
    }
}

module.exports = Fan
