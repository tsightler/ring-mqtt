const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const path = require('path')
const pathToFfmpeg = require('ffmpeg-for-homebridge');
const spawn = require('await-spawn')
const fs = require('fs');
const { SSL_OP_SSLEAY_080_CLIENT_DH_BUG } = require('constants');

class Camera {
    constructor(deviceInfo) {
        // Set default properties for camera device object model 
        this.camera = deviceInfo.device
        this.mqttClient = deviceInfo.mqttClient
        this.subscribed = false
        this.availabilityState = 'init'
        this.heartbeat = 3
        this.locationId = this.camera.data.location_id
        this.deviceId = this.camera.data.device_id
        this.config = deviceInfo.CONFIG
        this.snapshotMotion = false
        this.snapshotInterval = false
        this.snapshotAutoInterval = false

        // If snapshot capture is enabled, set approprate values
        if (this.config.snapshot_mode === "motion" || this.config.snapshot_mode === "interval" || this.config.snapshot_mode === "all" ) {
            this.snapshot = { imageData: null, timestamp: null }
            this.snapshotMotion = (this.config.snapshot_mode === "motion" || this.config.snapshot_mode === "all") ? true : false

            if (this.config.snapshot_mode === "interval" || this.config.snapshot_mode === "all") {
                if (this.camera.operatingOnBattery) {
                    this.snapshotAutoInterval = true
                    if (this.camera.data.settings.hasOwnProperty('lite_24x7') && this.camera.data.settings.lite_24x7.enabled) {
                        this.snapshotInterval = this.camera.data.settings.lite_24x7.frequency_secs
                    } else {
                        this.snapshotInterval = 600
                    }
                } else {
                    this.snapshotInterval = 30
                }
            }
        }

        // Sevice data for Home Assistant device registry 
        this.deviceData = { 
            ids: [ this.deviceId ],
            name: this.camera.name,
            mf: 'Ring',
            mdl: this.camera.model
        }

        // Set device location and top level MQTT topics
        this.cameraTopic = deviceInfo.CONFIG.ring_topic+'/'+this.locationId+'/camera/'+this.deviceId
        this.availabilityTopic = this.cameraTopic+'/status'

        // Create properties to store motion ding state
        this.motion = {
            active_ding: false,
            ding_duration: 180,
            last_ding: 0,
            last_ding_expires: 0
        }

        // If doorbell create properties to store doorbell ding state
        if (this.camera.isDoorbot) {
            this.ding = {
                active_ding: false,
                ding_duration: 180,
                last_ding: 0,
                last_ding_expires: 0
            }
        }

        // Properties to store state published to MQTT
        // Used to keep from sending state updates on every poll (20 seconds)
        if (this.camera.hasLight) {
            this.publishedLightState = 'unknown'
        }

        if (this.camera.hasSiren) {
            this.publishedSirenState = 'unknown'
        }

    }

    // Publish camera capabilities and state and subscribe to events
    async publish() {
        const debugMsg = (this.availabilityState == 'init') ? 'Publishing new ' : 'Republishing existing '
        debug(debugMsg+'device id: '+this.deviceId)

        // Publish motion sensor feature for camera
        this.publishCapability({
            type: 'motion',
            component: 'binary_sensor',
            className: 'motion',
            suffix: 'Motion',
            command: false
        })

        // If doorbell publish doorbell sensor
        if (this.camera.isDoorbot) {
            this.publishCapability({
                type: 'ding',
                component: 'binary_sensor',
                className: 'occupancy',
                suffix: 'Ding',
                command: false
            })
        }

        // If camera has a light publish light component
        if (this.camera.hasLight) {
            this.publishCapability({
                type: 'light',
                component: 'light',
                suffix: 'Light',
                command: 'command'
            })
        }

        // If camera has a siren publish switch component
        if (this.camera.hasSiren) {
            this.publishCapability({
                type: 'siren',
                component: 'switch',
                suffix: 'Siren',
                command: 'command'
            })
        }

        // Publish info sensor for camera
        this.publishCapability({
            type: 'info',
            component: 'sensor',
            suffix: 'Info',
            command: false
        })

        // If snapshots enabled, publish snapshot capability
        if (this.snapshotMotion || this.snapshotInterval) {
            this.publishCapability({
                type: 'snapshot',
                component: 'camera',
                suffix: 'Snapshot',
                command: 'interval'
            })
        }
        
        // Give Home Assistant time to configure device before sending first state data
        await utils.sleep(2)

        // Publish device state and, if new device, subscribe for state updates
        if (!this.subscribed) {
            this.subscribed = true

            // Subscribe to Ding events (all cameras have at least motion events)
            this.camera.onNewDing.subscribe(ding => {
                this.publishDingState(ding)
            })
            // Since this is initial publish of device publish current ding state as well
            this.publishDingState()

            // Subscribe to poll events, default every 20 seconds
            this.camera.onData.subscribe(() => {
                this.publishPolledState()
                
                // Update snapshot frequency in case it's changed
                if (this.snapshotAutoInterval && this.camera.data.settings.hasOwnProperty('lite_24x7')) {
                    this.snapshotInterval = this.camera.data.settings.lite_24x7.frequency_secs
                }
            })

            // Publish snapshot if enabled
            if (this.snapshotMotion || this.snapshotInterval) {
                this.publishSnapshot(true)
                // If interval based snapshots are enabled, start snapshot refresh loop
                if (this.snapshotInterval) {
                    this.scheduleSnapshotRefresh()
                }
            }

            // Start monitor of availability state for camera
            this.monitorCameraConnection()
        } else {
            // Pulish all data states and availability state for camera
            this.publishDingState()
            if (this.camera.hasLight || this.camera.hasSiren) {
                if (this.camera.hasLight) { this.publishedLightState = 'republish' }
                if (this.camera.hasSiren) { this.publishedSirenState = 'republish' }
                this.publishPolledState()
            }

            // Publish snapshot image if any snapshot option is enabled
            if (this.snapshotMotion || this.snapshotInterval) {
                this.publishSnapshot()
            }     

            this.publishInfoState()
            this.publishAvailabilityState()
        }
    }

    // Publish state messages via MQTT with optional debug
    publishMqtt(topic, message, enableDebug) {
        if (enableDebug) { debug(topic, message) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Build and publish a Home Assistant MQTT discovery packet for camera capability
    async publishCapability(capability) {
        const componentTopic = this.cameraTopic+'/'+capability.type
        const configTopic = 'homeassistant/'+capability.component+'/'+this.locationId+'/'+this.deviceId+'_'+capability.type+'/config'

        const message = {
            name: this.camera.name+' '+capability.suffix,
            unique_id: this.deviceId+'_'+capability.type,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline'
        }

        if (capability.type === 'snapshot') {
            message.topic = componentTopic+'/image'
            message.json_attributes_topic = componentTopic+'/attributes'
        } else {
            message.state_topic = componentTopic+'/state'
        }

        if (capability.className) { message.device_class = capability.className }

        if (capability.command) {
            if (capability.type !== 'snapshot') {
                message.command_topic = componentTopic+'/'+capability.command
            }
            this.mqttClient.subscribe(componentTopic+'/'+capability.command)
        }

        // Set the primary state value for info sensors based on power (battery/wired)
        // and connectivity (Wifi/ethernet)
        if (capability.type === 'info') {
            message.json_attributes_topic = componentTopic+'/state'
            message.icon = 'mdi:information-outline'
            const deviceHealth = await Promise.race([this.camera.getHealth(), utils.sleep(5)]).then(function(result) { return result; })
            if (deviceHealth) {
                if (deviceHealth.network_connection && deviceHealth.network_connection === 'ethernet') {
                    message.value_template = '{{value_json["wiredNetwork"]}}'
                } else {
                    // Device is connected via wifi, track that as primary
                    message.value_template = '{{value_json["wirelessSignal"]}}'
                    message.unit_of_measurement = 'RSSI'
                }
            }
        }

        // Add device data for Home Assistant device registry
        message.device = this.deviceData

        debug('HASS config topic: '+configTopic)
        debug(message)
        this.mqttClient.publish(configTopic, JSON.stringify(message), { qos: 1 })
    }

    // Process a ding event from camera or publish existing ding state
    async publishDingState(ding) {
        // Is it an active ding (i.e. from a subscribed event)?
        if (ding) {
            // Is it a motion or doorbell ding (for others we do nothing)?
            if (ding.kind !== 'ding' && ding.kind !== 'motion') { return }
            debug('Ding of kind '+ding.kind+' received at '+ding.now+' from camera '+this.deviceId)
 
            // Is it a motion or doorbell ding?
            const stateTopic = this.cameraTopic+'/'+ding.kind+'/state'

            // Update time for most recent ding and expire time of ding (Ring seems to be 180 seconds for all dings)
            this[ding.kind].last_ding = Math.floor(ding.now)
            this[ding.kind].ding_duration = ding.expires_in
            // Calculate new expire time for ding (ding.now + ding.expires_in)
            this[ding.kind].last_ding_expires = this[ding.kind].last_ding+ding.expires_in

            // Publish MQTT active sensor state
            // Will republish to MQTT for new dings even if ding is already active
            this.publishMqtt(stateTopic, 'ON', true)

            // If it's a motion ding and motion snapshots are enabled, grab and publish the latest snapshot
            if (ding.kind === 'motion' && this.snapshotMotion) {
                this.publishSnapshot(true, true)
            }

            // If ding was not already active, set active ding state property and begin loop
            // to check for ding expiration
            if (!this[ding.kind].active_ding) {
                this[ding.kind].active_ding = true
                // Loop until current time is > last_ding expires time.  Sleeps until
                // estimated exire time, but may loop if new dings increase last_ding_expires
                while (Math.floor(Date.now()/1000) < this[ding.kind].last_ding_expires) {
                    const sleeptime = (this[ding.kind].last_ding_expires - Math.floor(Date.now()/1000)) + 1
                    debug('Ding of kind '+ding.kind+' from camera '+this.deviceId+' expires in '+sleeptime)
                    await utils.sleep(sleeptime)
                    debug('Ding of kind '+ding.kind+' from camera '+this.deviceId+' exired')
                }
                // All dings have expired, set state back to false/off
                debug('All dings of kind '+ding.kind+' from camera '+this.deviceId+' have expired')
                this[ding.kind].active_ding = false
                this.publishMqtt(stateTopic, 'OFF', true)
            }
        } else {
            // Not an active ding so just publish existing ding state
            this.publishMqtt(this.cameraTopic+'/motion/state', (this.motion.active_ding ? 'ON' : 'OFF'), true)
            if (this.camera.isDoorbot) {
                this.publishMqtt(this.cameraTopic+'/ding/state', (this.ding.active_ding ? 'ON' : 'OFF'), true)
            }
        }
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    publishPolledState() {
        if (this.camera.hasLight) {
            const stateTopic = this.cameraTopic+'/light/state'
            if (this.camera.data.led_status !== this.publishedLightState) {
                this.publishMqtt(stateTopic, (this.camera.data.led_status === 'on' ? 'ON' : 'OFF'), true)
                this.publishedLightState = this.camera.data.led_status
            }
        }
        if (this.camera.hasSiren) {
            const stateTopic = this.cameraTopic+'/siren/state'
            const sirenStatus = this.camera.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenStatus !== this.publishedSirenState) {
                this.publishMqtt(stateTopic, sirenStatus, true)
                this.publishedSirenState = sirenStatus
            }
        }

        // Reset heartbeat counter on every polled state and set device online if not already
        this.heartbeat = 3
        if (this.availabilityState !== 'online') { this.online() }
    }

    // Publish device data to info topic
    async publishInfoState(deviceHealth) {
        if (!deviceHealth) { 
            deviceHealth = await Promise.race([this.camera.getHealth(), utils.sleep(5)]).then(function(result) {
                return result;
            })
        }
        
        if (deviceHealth) {
            const attributes = {}
            if (this.camera.hasBattery) {
                attributes.batteryLevel = deviceHealth.battery_percentage
            }
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at
            if (deviceHealth.network_connection && deviceHealth.network_connection === 'ethernet') {
                attributes.wiredNetwork = this.camera.data.alerts.connection
            } else {
                attributes.wirelessNetwork = deviceHealth.wifi_name
                attributes.wirelessSignal = deviceHealth.latest_signal_strength
            }
            this.publishMqtt(this.cameraTopic+'/info/state', JSON.stringify(attributes), true)
        }
    }

    // Publish snapshot image/metadata
    async publishSnapshot(refresh, isMotion) {
        // If refresh = true, get updated snapshot image before publishing
        let newSnapshot
        if (refresh) {
            try {
                newSnapshot = (isMotion && !this.camera.operatingOnBattery) ? await this.getLivestreamSnapshot() : await this.camera.getSnapshot()
            } catch(e) {
                debug(e.message)
            }
            if (newSnapshot) {
                this.snapshot.imageData = newSnapshot
                this.snapshot.timestamp = Math.round(Date.now()/1000)
            } else {
                debug('Could not retrieve updated snapshot for camera '+this.deviceId+', using previously cached snapshot.')
            }
        }

        debug(this.cameraTopic+'/snapshot/image', '<binary_image_data>')
        this.publishMqtt(this.cameraTopic+'/snapshot/image', this.snapshot.imageData)
        this.publishMqtt(this.cameraTopic+'/snapshot/attributes', JSON.stringify({ timestamp: this.snapshot.timestamp }))
    }

    // Refresh snapshot on scheduled interval
    async scheduleSnapshotRefresh() {
        await utils.sleep(this.snapshotInterval)
        // During active motion events stop interval snapshots
        if (this.snapshotMotion && !this.motion.active_ding) { 
            this.publishSnapshot(true)
        }
        this.scheduleSnapshotRefresh()
    }

    async startSipSession(duration, file) {
        try {
            debug('Connecting to SIP video stream for camera: '+this.deviceId)
            const sipSession = await this.camera.streamVideo({
                output: ['-codec', 'copy', '-t', duration, file, ],
            })

            sipSession.onCallEnded.subscribe(() => {
                try {
                    if (fs.existsSync(file)) { fs.unlinkSync(file) }
                } catch(err) {
                    debug(err.message)
                }
            })

            return sipSession

        } catch(e) {
            debug(e.message)
            return false
        }
    }

    // Check if stream starts within 5 seconds
    async checkStream(file) {
        for (let i = 0; i < 5; i++) {
            if (utils.checkFile(file, 50000)) {
                return true
            }
            await utils.sleep(1)
        }
        return false
    }

    // Attempt to start live stream with retries
    async tryStreamStart(path, retries) {
        for (let i = 0; i < retries; i++) {
            const filePrefix = this.deviceId+'_motion_'+Date.now() 
            const aviFile = path.join(path, filePrefix+'.avi')
            const sipSession = await this.startSipSession(10, aviFile)
            if (sipSession) {
                const isStreaming = await this.checkStream(aviFile)
                if (isStreaming) {
                    debug ('Established live stream for camera: '+this.deviceId)
                    return aviFile
                } else {
                    debug ('Live stream for camera '+this.deviceId+' failed to start, retrying...')
                }
            }
        }
        debug ('Live stream for camera '+this.deviceId+' failed to start after all retries, aborting!')
        return false
    }

    async getLiveStreamSnapshot() {
        if (this.snapshot.updating) {
            debug ('Snapshot update from live steam already in progress for camera: '+this.deviceId)
            return 
        }

        this.snapshot.updating = true        
        debug('Attempting to connect to live stream for camera: '+this.deviceId)
        const aviFile = await this.tryStreamStart('/tmp', 2)
        
        if (aviFile) {
            try {
                debug('Grabbing snapshot from live stream for camera: '+this.deviceId)
                // Attempts to grab snapshot from key frame
                await spawn(pathToFfmpeg, ['-i', aviPath, '-s', '640:360', '-vf', "select='eq(pict_type\,I)'", '-vframes', '1', '-q:v', '2', jpgPath])
                if (utils.checkFile(jpgPath)) {
                    debug('Successfully grabbed snapshot image from live stream for camera: '+this.deviceId)
                    const newSnapshot = fs.readFileSync(jpgPath)
                    fs.unlinkSync(jpgPath)
                    return newSnapshot
                }
            } catch (e) {
                console.log(e.stderr.toString())
            }
        } else {
            debug('Failed to get snapshot from live stream for camera: '+this.deviceId)
            return false
        }
    }

    // Publish heath state every 5 minutes
    async publishDeviceHealth() {
        if (this.availabilityState === 'online') {
            const deviceHealth = await this.camera.getHealth()
            publishInfoState(deviceHealth)
            await utils.sleep(300)
            this.publishDeviceHealth
        } else {
            await utils.sleep(60)
        }
        this.publishDeviceHealth()
    }

    // Simple check for heartbeat based on polled status since cameras
    async monitorCameraConnection() {
        if (this.heartbeat < 1 && this.availabilityState !== 'offline') {
            this.offline()
        } else {
            this.heartbeat--
        }
        await utils.sleep(20)
        this.monitorCameraConnection()
    }

    // Process messages from MQTT command topic
    processCommand(message, topic) {
        topic = topic.split('/')
        const component = topic[topic.length - 2]
        switch(component) {
            case 'light':
                this.setLightState(message)
                break;
            case 'siren':
                this.setSirenState(message)
                break;
            case 'snapshot':
                this.setSnapshotInterval(message)
                break;
            default:
                debug('Somehow received message to unknown state topic for camera Id: '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setLightState(message) {
        debug('Received set light state '+message+' for camera Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        switch (message) {
            case 'ON':
                this.camera.setLight(true)
                break;
            case 'OFF':
                this.camera.setLight(false)
                break;
            default:
                debug('Received unknown command for light on camera ID '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setSirenState(message) {
        debug('Received set siren state '+message+' for camera Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        switch (message) {
            case 'ON':
                this.camera.setSiren(true)
                break;
            case 'OFF':
                this.camera.setSiren(false)
                break;
            default:
                debug('Received unkonw command for light on camera ID '+this.deviceId)
        }
    }

    // Set refresh interval for snapshots
    setSnapshotInterval(message) {
        debug('Received set snapshot refresh interval '+message+' for camera Id: '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
            debug ('Received invalid interval')
        } else {
            this.snapshotInterval = (message >= 10) ? Math.round(message) : 10
            this.snapshotAutoInterval = false
            debug ('Snapshot refresh interval as been set to '+this.snapshotInterval+' seconds')
        }
    }

    // Publish availability state
    publishAvailabilityState(enableDebug) {
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
    }

    // Set state topic online
    async online() {
        const enableDebug = (this.availabilityState == 'online') ? false : true
        await utils.sleep(1)
        this.availabilityState = 'online'
        this.publishAvailabilityState(enableDebug)
    }

    // Set state topic offline
    offline() {
        const enableDebug = (this.availabilityState == 'offline') ? false : true
        this.availabilityState = 'offline'
        this.publishAvailabilityState(enableDebug)
    }
}

module.exports = Camera
