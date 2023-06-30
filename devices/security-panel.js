import RingSocketDevice from './base-socket-device.js'
import { allAlarmStates, RingDeviceType } from 'ring-client-api'
import utils from '../lib/utils.js'
import state from '../lib/state.js'

export default class SecurityPanel extends RingSocketDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'alarm', 'alarmState')
        this.deviceData.mdl = 'Alarm Control Panel'
        this.deviceData.name = `${this.device.location.name} Alarm`

        this.data = {
            mode: this.device.data.mode,
            attributes: {
                lastArmedBy: 'Unknown',
                lastArmedTime: '',
                lastDisarmedBy: 'Unknown',
                lastDisarmedTime: ''
            }
        }

        this.entity = {
            ...this.entity,
            alarm: {
                component: 'alarm_control_panel',
                attributes: true,
                isLegacyEntity: true  // Legacy compatibility
            },
            siren: {
                component: 'switch',
                icon: 'mdi:alarm-light',
                name: `${this.device.location.name} Siren`
            },
            ...utils.config().enable_panic ? {
                police: {
                    component: 'switch',
                    name: `${this.device.location.name} Panic - Police`,
                    icon: 'mdi:police-badge'
                },
                fire: {
                    component: 'switch',
                    name: `${this.device.location.name} Panic - Fire`,
                    icon: 'mdi:fire'
                }
            } : {}
        }

        this.initAlarmAttributes()

        // Listen to raw data updates for all devices and pick out
        // arm/disarm events for this security panel
        this.device.location.onDataUpdate.subscribe(async (message) => {
            console.log(JSON.stringify(message, null, 4))
            if (this.isOnline() &&
                message.datatype === 'DeviceInfoDocType' &&
                message.body?.[0]?.general?.v2?.zid === this.deviceId &&
                message.body[0].impulse?.v1?.[0] &&
                message.body[0].impulse.v1.filter(i =>
                    i.impulseType.match('security-panel.mode-switched.') ||
                    i.impulseType.match('security-panel.exit-delay')
                ).length > 0
            ) {
                const impulse = message.body[0].impulse.v1
                if (message.context) {
                    if (impulse.filter(i => i.impulseType.match(/some|all|exit-delay/)).length > 0) {
                        await this.updateAlarmAttributes(message.context, 'Armed')
                    } else if (impulse.filter(i => i.impulseType.includes('none')).length > 0) {
                        await this.updateAlarmAttributes(message.context, 'Disarmed')
                    }
                }
                this.publishAlarmState()
            }
        })
    }

    async initAlarmAttributes() {
        const alarmEvents = await this.device.location.getHistory({ affectedId: this.deviceId })
        const armEvents = alarmEvents.filter(e =>
            Array.isArray(e.body?.[0]?.impulse?.v1) &&
            e.body[0].impulse.v1.filter(i =>
                i.data?.commandType === 'security-panel.switch-mode' &&
                i.data?.data?.mode.match(/some|all/)
            ).length > 0
        )
        if (armEvents.length > 0) {
            this.updateAlarmAttributes(armEvents[0].context, 'Armed')
        }

        const disarmEvents = alarmEvents.filter(e =>
            Array.isArray(e.body?.[0]?.impulse?.v1) &&
            e.body[0].impulse.v1.filter(i =>
                i.data?.commandType === 'security-panel.switch-mode' &&
                i.data?.data?.mode === 'none'
            ).length > 0
        )
        if (disarmEvents.length > 0) {
            this.updateAlarmAttributes(disarmEvents[0].context, 'Disarmed')
        }
    }

    async updateAlarmAttributes(contextData, mode) {
        let initiatingUser = contextData.initiatingEntityType

        if (contextData.initiatingEntityType === 'user' && contextData.initiatingEntityId) {
            try {
                const userInfo = await this.getUserInfo(contextData.initiatingEntityId)
                if (userInfo) {
                    initiatingUser = `${userInfo.firstName} ${userInfo.lastName}`
                } else {
                    throw new Error('Invalid user information was returned by API')
                }
            } catch (err) {
                this.debug(err.message)
                this.debug('Could not get user information from Ring API')
            }
        }

        this.data.attributes[`last${mode}By`] = initiatingUser
        this.data.attributes[`last${mode}Time`] = new Date(contextData.eventOccurredTsMs).toISOString()
    }

    publishState(data) {
        const isPublish = data === undefined ? true : false

        if (allAlarmStates.includes(this.device.data.alarmInfo?.state) || isPublish) {
            this.publishAlarmState()
        }

        const sirenState = (this.device.data.siren?.state === 'on') ? 'ON' : 'OFF'
        this.mqttPublish(this.entity.siren.state_topic, sirenState)

        if (utils.config().enable_panic) {
            const policeState = this.device.data.alarmInfo?.state?.match(/burglar|panic/) ? 'ON' : 'OFF'
            if (policeState === 'ON') { this.debug('Burglar alarm is triggered for ' + this.device.location.name) }
            this.mqttPublish(this.entity.police.state_topic, policeState)

            const fireState = this.device.data.alarmInfo?.state?.match(/co|fire/) ? 'ON' : 'OFF'
            if (fireState === 'ON') { this.debug('Fire alarm is triggered for ' + this.device.location.name) }
            this.mqttPublish(this.entity.fire.state_topic, fireState)
        }
    }

    async publishAlarmState() {
        let alarmState

        // If alarm is active report triggered or, if entry-delay, pending
        if (allAlarmStates.includes(this.device.data.alarmInfo?.state))  {
            alarmState = this.device.data.alarmInfo.state === 'entry-delay' ? 'pending' : 'triggered'
        } else {
            switch(this.device.data.mode) {
                case 'none':
                    alarmState = 'disarmed'
                    break;
                case 'some':
                    alarmState = 'armed_home'
                    break;
                case 'all':
                    const exitDelayMs = this.device.data.transitionDelayEndTimestamp - Date.now()
                    if (exitDelayMs > 0) {
                        alarmState = 'arming'
                        this.waitForExitDelay(exitDelayMs)
                    } else {
                        alarmState = 'armed_away'
                    }
                    break;
                default:
                    alarmState = 'unknown'
            }
        }

        this.mqttPublish(this.entity.alarm.state_topic, alarmState)
        this.mqttPublish(this.entity.alarm.json_attributes_topic, JSON.stringify(this.data.attributes), 'attr')
        this.publishAttributes()
    }

    async waitForExitDelay(exitDelayMs) {
        await utils.msleep(exitDelayMs)
        if (this.device.data.mode === 'all') {
            exitDelayMs = this.device.data.transitionDelayEndTimestamp - Date.now()
            if (exitDelayMs <= 0) {
                // Publish device sensor state
                this.mqttPublish(this.entity.alarm.state_topic, 'armed_away')
            }
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        switch (command) {
            case 'alarm/command':
                this.setAlarmMode(message)
                break;
            case 'siren/command':
                this.setSirenMode(message)
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
                this.debug(`Received message to unknown command topic: ${command}`)
        }
    }

    // Set Alarm Mode on received MQTT command message
    async setAlarmMode(message) {
        this.debug(`Received set alarm mode ${message} for location ${this.device.location.name} (${this.locationId})`)

        // Try to set alarm mode and retry after delay if mode set fails
        // Performing initial arming attempt with no delay
        let retries = 5
        let setAlarmSuccess = false
        while (retries-- > 0 && !(setAlarmSuccess)) {
            const bypassDeviceIds = []

            if (message.toLowerCase() !== 'disarm') {
                // During arming, check for sensors that require bypass
                // Get all devices that allow bypass
                const bypassDevices = (await this.device.location.getDevices()).filter(device =>
                    device.deviceType === RingDeviceType.ContactSensor ||
                    device.deviceType === RingDeviceType.RetrofitZone ||
                    device.deviceType === RingDeviceType.MotionSensor ||
                    device.deviceType === RingDeviceType.TiltSensor ||
                    device.deviceType === RingDeviceType.GlassbreakSensor
                ),
                savedStates = state.getAllSavedStates(),
                bypassDeviceNames = []

                // Loop through all bypass eligible devices and bypass based on settings/state
                for (const device of bypassDevices) {
                    const bypassMode = savedStates[device.id]?.bypass_mode
                    if (bypassMode === 'Always' || (bypassMode === 'Faulted' && device.data.faulted)) {
                        bypassDeviceIds.push(device.id)
                        bypassDeviceNames.push(`${device.name} [${bypassMode}]`)
                    }
                }

                if (bypassDeviceIds.length > 0) {
                    this.debug(`The following sensors will be bypassed [Reason]: ${bypassDeviceNames.join(', ')}`)
                } else {
                    this.debug('No sensors will be bypased')
                }
            }

            setAlarmSuccess = await this.trySetAlarmMode(message, bypassDeviceIds)

            // On failure delay 10 seconds for next set attempt
            if (!setAlarmSuccess) { await utils.sleep(10) }
        }

        // Check the return status and print some debugging for failed states
        if (!setAlarmSuccess) {
            this.debug('Alarm could not enter proper arming mode after all retries...Giving up!')
        } else if (setAlarmSuccess == 'unknown') {
            this.debug('Unknown alarm arming mode requested.')
        }
    }

    async trySetAlarmMode(message, bypassDeviceIds) {
        let alarmTargetMode
        this.debug(`Set alarm mode: ${message}`)
        switch(message.toLowerCase()) {
            case 'disarm':
                this.device.location.disarm().catch(err => { this.debug(err) })
                alarmTargetMode = 'none'
                break
            case 'arm_home':
                this.device.location.armHome(bypassDeviceIds).catch(err => { this.debug(err) })
                alarmTargetMode = 'some'
                break
            case 'arm_away':
                this.device.location.armAway(bypassDeviceIds).catch(err => { this.debug(err) })
                alarmTargetMode = 'all'
                break
            default:
                this.debug('Cannot set alarm mode: Unknown')
                return 'unknown'
        }

        // Sleep a few seconds and check if alarm entered requested mode
        await utils.sleep(1);
        if (this.device.data.mode == alarmTargetMode) {
            this.debug(`Alarm for location ${this.device.location.name} successfully entered ${message} mode`)
            return true
        } else {
            this.debug(`Alarm for location ${this.device.location.name} failed to enter requested arm/disarm mode!`)
            return false
        }
    }

    async setSirenMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                this.debug(`Activating siren for ${this.device.location.name}`)
                this.device.location.soundSiren().catch(err => { this.debug(err) })
                break;
            case 'off': {
                this.debug(`Deactivating siren for ${this.device.location.name}`)
                this.device.location.silenceSiren().catch(err => { this.debug(err) })
                break;
            }
            default:
                this.debug('Received invalid command for siren!')
        }
    }

    async setPoliceMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                this.debug(`Activating burglar alarm for ${this.device.location.name}`)
                this.device.location.triggerBurglarAlarm().catch(err => { this.debug(err) })
                break;
            case 'off': {
                this.debug(`Deactivating burglar alarm for ${this.device.location.name}`)
                this.device.location.setAlarmMode('none').catch(err => { this.debug(err) })
                break;
            }
            default:
                this.debug('Received invalid command for panic!')
        }
    }

    async setFireMode(message) {
        switch(message.toLowerCase()) {
            case 'on':
                this.debug(`Activating fire alarm for ${this.device.location.name}`)
                this.device.location.triggerFireAlarm().catch(err => { this.debug(err) })
                break;
            case 'off': {
                this.debug(`Deactivating fire alarm for ${this.device.location.name}`)
                this.device.location.setAlarmMode('none').catch(err => { this.debug(err) })
                break;
            }
            default:
                this.debug('Received invalid command for panic!')
        }
    }
}
