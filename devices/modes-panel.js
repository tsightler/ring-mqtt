const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const RingPolledDevice = require('./base-polled-device')

class ModesPanel extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'disable')
        this.deviceData.mdl = 'Mode Control Panel'
        this.deviceData.name = `${this.device.location.name} Mode`

        this.entity.mode = {
            component: 'alarm_control_panel',
            isLegacyEntity: true  // Legacy compatibility
        }

        this.data = {
            currentMode: undefined
        }
    }
    
    publishData(data) {
        const isPublish = data === undefined ? true : false
        const mode = (isPublish) ? this.device.location.getLocationMode() : data
        // Publish device state if it's changed from prior state
        if (this.data.currentMode !== mode || isPublish) {
            this.data.currentMode = mode
            let mqttMode
            switch(mode) {
                case 'disarmed':
                    mqttMode = 'disarmed'
                    break;
                case 'home':
                    mqttMode = 'armed_home'
                    break;
                case 'away':
                    mqttMode = 'armed_away'
                    break;
                default:
                    mqttMode = 'disarmed'
            }
            this.publishMqtt(this.entity.mode.state_topic, mqttMode, true)
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        switch (componentCommand) {
            case 'mode/command':
                this.setLocationMode(message)
                break;
            default:
                debug('Received unknown mode command topic '+topic+' for location: '+this.deviceId)
        }
    }
    
    // Set Alarm Mode on received MQTT command message
    async setLocationMode(message) {
        debug('Received command set mode '+message+' for location '+this.device.location.name+' ('+this.locationId+')')

        // Try to set alarm mode and retry after delay if mode set fails
        // Initial attempt with no delay
        let delay = 0
        let retries = 6
        let setModeSuccess = false
        while (retries-- > 0 && !(setModeSuccess)) {
            setModeSuccess = await this.trySetMode(message, delay)
            // On failure delay 10 seconds before next set attempt
            delay = 10
        }
        // Check the return status and print some debugging for failed states
        if (setModeSuccess == false ) {
            debug('Location could not enter proper mode after all retries...Giving up!')
        } else if (setModeSuccess == 'unknown') {
            debug('Ignoring unknown command.')
        }
    }

    async trySetMode(message, delay) {
        await utils.sleep(delay)
        let targetMode
        switch(message.toLowerCase()) {
            case 'disarm':
                targetMode = 'disarmed'
                break
            case 'arm_home':
                targetMode = 'home'
                break
            case 'arm_away':
                targetMode = 'away'
                break
            default:
                debug('Cannot set location mode: Unknown')
                return 'unknown'
        }
        debug('Set location mode: '+targetMode)
        await this.device.location.setLocationMode(targetMode)

        // Sleep a 1 second and check if location entered the requested mode
        await utils.sleep(1);
        if (targetMode == (await this.device.location.getLocationMode()).mode) {
            debug('Location '+this.device.location.name+' successfully entered '+message+' mode')
            return true
        } else {
            debug('Location '+this.device.location.name+' failed to enter requested mode!')
            return false
        }
    }
}

module.exports = ModesPanel
