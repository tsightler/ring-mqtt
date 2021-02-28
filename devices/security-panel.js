const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const AlarmDevice = require('./alarm-device')
const alarmStates = require('ring-client-api').allAlarmStates
const RingDeviceType = require('ring-client-api').RingDeviceType

class SecurityPanel extends AlarmDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        // Home Assistant component type
        this.component = 'alarm_control_panel'

        // Device data for Home Assistant device registry
        this.deviceData.mdl = 'Alarm Control Panel'
        this.deviceData.name = this.device.location.name + ' Alarm'

        // Build required MQTT topics
        this.stateTopic = this.deviceTopic+'/alarm/state'
        this.commandTopic = this.deviceTopic+'/alarm/command'
        this.configTopic = 'homeassistant/'+this.component+'/'+this.locationId+'/'+this.deviceId+'/config'
        
        this.stateTopic_siren = this.deviceTopic+'/siren/state'
        this.commandTopic_siren = this.deviceTopic+'/siren/command'
        this.configTopic_siren = 'homeassistant/switch/'+this.locationId+'/'+this.deviceId+'_siren/config'

        this.stateTopic_bypass = this.deviceTopic+'/bypass/state'
        this.commandTopic_bypass = this.deviceTopic+'/bypass/command'
        this.configTopic_bypass = 'homeassistant/switch/'+this.locationId+'/'+this.deviceId+'_bypass/config'
        this.bypassEnabled = false

        if (this.config.enable_panic) {
            // Build required MQTT topics for device
            this.stateTopic_police = this.deviceTopic+'/police/state'
            this.commandTopic_police = this.deviceTopic+'/police/command'
            this.configTopic_police = 'homeassistant/switch/'+this.locationId+'/'+this.deviceId+'_police/config'

            this.stateTopic_fire = this.deviceTopic+'/fire/state'
            this.commandTopic_fire = this.deviceTopic+'/fire/command'
            this.configTopic_fire = 'homeassistant/switch/'+this.locationId+'/'+this.deviceId+'_fire/config'
        }
    }

    initDiscoveryData() {
        // Build the MQTT discovery messages
        this.discoveryData.push({
            message: {
                name: this.deviceData.name,
                unique_id: this.deviceId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic,
                command_topic: this.commandTopic,
                device: this.deviceData
            },
            configTopic: this.configTopic
        })

        this.discoveryData.push({
            message: {
                name: this.device.location.name+' Siren',
                unique_id: this.deviceId+'_siren',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_siren,
                command_topic: this.commandTopic_siren,
                device: this.deviceData
            },
            configTopic: this.configTopic_siren
        })

        this.discoveryData.push({
            message: {
                name: this.device.location.name+' Arming Bypass Mode',
                unique_id: this.deviceId+'_bypass',
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                state_topic: this.stateTopic_bypass,
                command_topic: this.commandTopic_bypass,
                device: this.deviceData
            },
            configTopic: this.configTopic_bypass
        })

        if (this.config.enable_panic) {
            this.discoveryData.push({
                message: {
                    name: this.device.location.name+' Panic - Police',
                    unique_id: this.deviceId+'_police',
                    availability_topic: this.availabilityTopic,
                    payload_available: 'online',
                    payload_not_available: 'offline',
                    state_topic: this.stateTopic_police,
                    command_topic: this.commandTopic_police,
                    device: this.deviceData
                },
                configTopic: this.configTopic_police
            })

            this.discoveryData.push({
                message: {
                    name: this.device.location.name+' Panic - Fire',
                    unique_id: this.deviceId+'_fire',
                    availability_topic: this.availabilityTopic,
                    payload_available: 'online',
                    payload_not_available: 'offline',
                    state_topic: this.stateTopic_fire,
                    command_topic: this.commandTopic_fire,
                    device: this.deviceData
                },
                configTopic: this.configTopic_fire
            })
        }
        this.initInfoDiscoveryData('alarmState')
    }

    publishData() {
        var alarmMode
        const alarmInfo = this.device.data.alarmInfo ? this.device.data.alarmInfo : []

        // If alarm is active report triggered or, if entry-delay, pending
        if (alarmStates.includes(alarmInfo.state))  {
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
                    alarmMode = 'armed_away'
                    break;
                default:
                    alarmMode = 'unknown'
            }
        }
        // Publish device sensor state
        this.publishMqtt(this.stateTopic, alarmMode, true)

        // Publish siren state
        const sirenState = (this.device.data.siren && this.device.data.siren.state === 'on') ? 'ON' : 'OFF'
        this.publishMqtt(this.stateTopic_siren, sirenState, true)

        // Publish bypass state
        const bypassState = this.bypassEnabled ? 'ON' : 'OFF'
        this.publishMqtt(this.stateTopic_bypass, bypassState, true)

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
            this.publishMqtt(this.stateTopic_police, policeState, true)
            this.publishMqtt(this.stateTopic_fire, fireState, true)
        }

        // Publish device attributes (batterylevel, tamper status)
        this.publishAttributes()
    }
    
    // Process messages from MQTT command topic
    processCommand(message, topic) {
        if (topic == this.commandTopic) {
            this.setAlarmMode(message)
        } else if (topic == this.commandTopic_siren) {
            this.setSirenMode(message)
        } else if (topic == this.commandTopic_bypass) {
            this.setBypassMode(message)
        } else if (topic == this.commandTopic_police) {
            this.setPoliceMode(message)
        } else if (topic == this.commandTopic_fire) {
            this.setFireMode(message)
        } else {
            debug('Somehow received unknown command topic '+topic+' for switch Id: '+this.deviceId)
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
            if (message.toLowerCase() !== 'disarm' && this.bypassEnabled) {
                const bypassDevices = (await this.device.location.getDevices()).filter((device) => {
                    return (
                        device.deviceType === RingDeviceType.ContactSensor &&
                        device.data.faulted
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
        if (setAlarmSuccess == false ) {
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
                this.bypassEnabled = true
                break;
            case 'off': {
                debug('Disabling arming bypass mode for '+this.device.location.name)
                this.bypassEnabled = false
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
