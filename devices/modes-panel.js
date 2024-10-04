import RingPolledDevice from './base-polled-device.js'
import utils from '../lib/utils.js'

export default class ModesPanel extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm', 'disable')
        this.deviceData.mdl = 'Mode Control Panel'
        this.deviceData.name = `${this.device.location.name} Mode`

        this.entity.mode = {
            component: 'alarm_control_panel',
            isMainEntity: true
        }

        this.data = {
            currentMode: undefined
        }
    }

    async publishState(data) {
        const isPublish = Boolean(data === undefined)
        const mode = (isPublish) ? (await this.device.location.getLocationMode()).mode : data
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
            this.mqttPublish(this.entity.mode.state_topic, mqttMode)
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        switch (command) {
            case 'mode/command':
                this.setLocationMode(message)
                break;
            default:
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set Alarm Mode on received MQTT command message
    async setLocationMode(message) {
        this.debug(`Received command set mode ${message} for location ${this.device.location.name} (${this.locationId})`)

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
            this.debug('Location could not enter proper mode after all retries...Giving up!')
        } else if (setModeSuccess == 'unknown') {
            this.debug('Ignoring unknown command.')
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
                this.debug('Cannot set location mode: Unknown')
                return 'unknown'
        }
        this.debug(`Set location mode: ${targetMode}`)
        await this.device.location.setLocationMode(targetMode)

        // Sleep a 1 second and check if location entered the requested mode
        await utils.sleep(1);
        if (targetMode == (await this.device.location.getLocationMode()).mode) {
            this.debug(`Location ${this.device.location.name} successfully entered ${message} mode`)
            return true
        } else {
            this.debug(`Location ${this.device.location.name} failed to enter requested mode!`)
            return false
        }
    }
}
