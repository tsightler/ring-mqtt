const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const { allAlarmStates, RingDeviceType } = require('ring-client-api')
const RingSocketDevice = require('./base-socket-device')

class SecurityPanel extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarmState')
        this.deviceData.mdl = 'Alarm Control Panel'
        this.deviceData.name = `${this.device.location.name} Alarm`
        
        this.entity.alarm = {
            component: 'alarm_control_panel',
            isLegacyEntity: true  // Legacy compatibility
        }
        this.entity.siren = {
            component: 'switch',
            icon: 'mdi:alarm-light',
            name: `${this.device.location.name} Siren`
        }
        this.entity.bypass = {
            component: 'switch',
            name: `${this.device.location.name} Arming Bypass Mode`,
            state: false,
            icon: 'mdi:transit-skip'
        }

        if (this.config.enable_panic) {
            this.entity.police = { 
                component: 'switch',
                name: `${this.device.location.name} Panic - Police`,
                icon: 'mdi:police-badge'
            }
            this.entity.fire = { 
                component: 'switch',
                name: `${this.device.location.name} Panic - Fire`,
                icon: 'mdi:fire'
            }
        }
    }

    publishData() {
        var alarmMode
        const alarmInfo = this.device.data.alarmInfo ? this.device.data.alarmInfo : []

        // If alarm is active report triggered or, if entry-delay, pending
        if (allAlarmStates.includes(alarmInfo.state))  {
            alarmMode = alarmInfo.state === 'entry-delay' ? 'pending' : 'triggered'
        } else {
            switch(this.device.data.mode) {
                case 'none':
                    alarmMode = 'disarmed'
                    break;
                case 'some':
                    alarmMode = 'armed_home'
                    break;
                case 'all':
                    const exitDelayMs = this.device.data.transitionDelayEndTimestamp - Date.now()
                    if (exitDelayMs > 0) {
                        alarmMode = 'arming'
                        this.waitForExitDelay(exitDelayMs)
                    } else {
                        alarmMode = 'armed_away'
                    }
                    break;
                default:
                    alarmMode = 'unknown'
            }
        }
        this.publishMqtt(this.entity.alarm.state_topic, alarmMode, true)

        const sirenState = (this.device.data.siren && this.device.data.siren.state === 'on') ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.siren.state_topic, sirenState, true)

        const bypassState = this.entity.bypass.state ? 'ON' : 'OFF'
        this.publishMqtt(this.entity.bypass.state_topic, bypassState, true)

        if (this.config.enable_panic) {
            let policeState = 'OFF'
            let fireState = 'OFF'
            const alarmState = this.device.data.alarmInfo ? this.device.data.alarmInfo.state : ''
            switch (alarmState) {
                case 'burglar-alarm':
                case 'user-verified-burglar-alarm':
                case 'burglar-accelerated-alarm':
                    policeState = 'ON'
                    debug('Burgler alarm is active for '+this.device.location.name)
                case 'fire-alarm':
                case 'co-alarm':
                case 'user-verified-co-or-fire-alarm':
                case 'fire-accelerated-alarm':
                    fireState = 'ON'
                    debug('Fire alarm is active for '+this.device.location.name)
            }
            this.publishMqtt(this.entity.police.state_topic, policeState, true)
            this.publishMqtt(this.entity.fire.state_topic, fireState, true)
        }

        this.publishAttributes()
    }
    
    async waitForExitDelay(exitDelayMs) {
        await utils.msleep(exitDelayMs)
        if (this.device.data.mode === 'all') {
            exitDelayMs = this.device.data.transitionDelayEndTimestamp - Date.now()
            if (exitDelayMs <= 0) {
                // Publish device sensor state
                this.publishMqtt(this.entity.alarm.state_topic, 'armed_away', true)
            }
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        const entityKey = componentCommand.split('/')[0]
        switch (componentCommand) {
            case 'alarm/command':
                this.setAlarmMode(message)
                break;
            case 'siren/command':
                this.setSirenMode(message)
                break;
            case 'bypass/command':
                this.setBypassMode(message)
                break;
            case 'police/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setPoliceMode(message)
                }
                break;
            case 'fire/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setFireMode(message)
                }
                break;
            default:
                debug('Received unknown command topic '+topic+' for switch: '+this.deviceId)
        }
    }

    // Set Alarm Mode on received MQTT command message
    async setAlarmMode(message) {
        debug('Received set alarm mode '+message+' for location '+this.device.location.name+' ('+this.locationId+')')

        // Try to set alarm mode and retry after delay if mode set fails
        // Initial attempt with no delay
        let retries = 5
        let setAlarmSuccess = false
        while (retries-- > 0 && !(setAlarmSuccess)) {
            let bypassDeviceIds = []

            // If arming bypass arming mode is enabled, get device ids requiring bypass
            if (message.toLowerCase() !== 'disarm' && this.entity.bypass.state) {
                const bypassDevices = (await this.device.location.getDevices()).filter((device) => {
                    return (
                        (device.deviceType === RingDeviceType.ContactSensor && device.data.faulted) ||
                        (device.deviceType === RingDeviceType.RetrofitZone && device.data.faulted)
                    )
                })

                if (bypassDevices.length > 0) {
                    bypassDeviceIds = bypassDevices.map((bypassDevice) => bypassDevice.id)
                    const bypassDeviceNames = bypassDevices.map((bypassDevice) => bypassDevice.name)
                    debug('Arming bypass mode is enabled, bypassing sensors: ' + bypassDeviceNames.join(', '))
                }
            }

            setAlarmSuccess = await this.trySetAlarmMode(message, bypassDeviceIds)

            // On failure delay 10 seconds for next set attempt
            if (!setAlarmSuccess) { await utils.sleep(10) }
        }
        // Check the return status and print some debugging for failed states
        if (!setAlarmSuccess) {
            debug('Alarm could not enter proper arming mode after all retries...Giving up!')
        } else if (setAlarmSuccess == 'unknown') {
            debug('Unknown alarm arming mode requested.')
        }
    }

    async trySetAlarmMode(message, bypassDeviceIds) {
        let alarmTargetMode
        debug('Set alarm mode: '+message)
        switch(message.toLowerCase()) {
            case 'disarm':
                this.device.location.disarm().catch(err => { debug(err) })
                alarmTargetMode = 'none'
                break
            case 'arm_home':
                this.device.location.armHome(bypassDeviceIds).catch(err => { debug(err) })
                alarmTargetMode = 'some'
                break
            case 'arm_away':
                this.device.location.armAway(bypassDeviceIds).catch(err => { debug(err) })
                alarmTargetMode = 'all'
                break
            default:
                debug('Cannot set alarm mode: Unknown')
                return 'unknown'
        }

        // Sleep a few seconds and check if alarm entered requested mode
        await utils.sleep(1);
        if (this.device.data.mode == alarmTargetMode) {
            debug('Alarm for location '+this.device.location.name+' successfully entered '+message+' mode')
            return true
        } else {
            debug('Alarm for location '+this.device.location.name+' failed to enter requested arm/disarm mode!')
            return false
        }
    }

    async setBypassMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                debug('Enabling arming bypass mode for '+this.device.location.name)
                this.entity.bypass.state = true
                break;
            case 'off': {
                debug('Disabling arming bypass mode for '+this.device.location.name)
                this.entity.bypass.state = false
                break;
            }
            default:
                debug('Received invalid command for arming bypass mode!')
        }
        this.publishData()
    }

    async setSirenMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                debug('Activating siren for '+this.device.location.name)
                this.device.location.soundSiren().catch(err => { debug(err) })
                break;
            case 'off': {
                debug('Deactivating siren for '+this.device.location.name)
                this.device.location.silenceSiren().catch(err => { debug(err) })
                break;
            }
            default:
                debug('Received invalid command for siren!')
        }
    }

    async setPoliceMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                debug('Activating burglar alarm for '+this.device.location.name)
                this.device.location.triggerBurglarAlarm().catch(err => { debug(err) })
                break;
            case 'off': {
                debug('Deactivating burglar alarm for '+this.device.location.name)
                this.device.location.setAlarmMode('none').catch(err => { debug(err) })
                break;
            }
            default:
                debug('Received invalid command for panic!')
        }
    }

    async setFireMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                debug('Activating fire alarm for '+this.device.location.name)
                this.device.location.triggerFireAlarm().catch(err => { debug(err) })
                break;
            case 'off': {
                debug('Deactivating fire alarm for '+this.device.location.name)
                this.device.location.setAlarmMode('none').catch(err => { debug(err) })
                break;
            }
            default:
                debug('Received invalid command for panic!')
        }
    }
}

module.exports = SecurityPanel
