const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const clientApi = require('../node_modules/ring-client-api/lib/api/rest-client').clientApi
const P2J = require('pipe2jpeg')
const net = require('net');
const getPort = require('get-port')

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
        this.publishedLightState = this.camera.hasLight ? 'init' : 'none'
        this.publishedSirenState = this.camera.hasSiren ? 'init' : 'none'

        // Configure initial snapshot parameters based on device type and app settings
        this.snapshot = { 
            motion: false, 
            interval: false,
            autoInterval: false,
            imageData: null,
            timestamp: null,
            updating: null
        }
        if (this.config.snapshot_mode === "motion" || this.config.snapshot_mode === "interval" || this.config.snapshot_mode === "all" ) {
            this.snapshot.motion = (this.config.snapshot_mode === "motion" || this.config.snapshot_mode === "all") ? true : false

            if (this.config.snapshot_mode === "interval" || this.config.snapshot_mode === "all") {
                this.snapshot.autoInterval = true
                if (this.camera.operatingOnBattery) {
                    if (this.camera.data.settings.hasOwnProperty('lite_24x7') && this.camera.data.settings.lite_24x7.enabled) {
                        this.snapshot.interval = this.camera.data.settings.lite_24x7.frequency_secs
                    } else {
                        this.snapshot.interval = 600
                    }
                } else {
                    this.snapshot.interval = 30
                }
            }
        }

        // Initialize livestream parameters
        this.livestream = {
            duration: (this.camera.data.settings.video_settings.hasOwnProperty('clip_length_max') && this.camera.data.settings.video_settings.clip_length_max) 
                      ? this.camera.data.settings.video_settings.clip_length_max
                      : 60,
            active: false,
            expires: 0,
            updateSnapshot: false
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
      
        // Create properties to store ding states
        this.motion = {
            name: 'motion',
            active_ding: false,
            ding_duration: 180,
            last_ding: 0,
            last_ding_expires: 0,
            last_ding_time: 'none',
            is_person: false
        }

        if (this.camera.isDoorbot) {
            this.ding = {
                name: 'doorbell',
                active_ding: false,
                ding_duration: 180,
                last_ding: 0,
                last_ding_expires: 0,
                last_ding_time: 'none'
            }
        }
    }

    // Publish camera capabilities and state and subscribe to events
    async publish() {
        const debugMsg = (this.availabilityState === 'init') ? 'Publishing new ' : 'Republishing existing '

        debug(debugMsg+'device id: '+this.deviceId)

        // Publish motion sensor feature for camera
        this.publishCapability({
            type: 'motion',
            component: 'binary_sensor',
            className: 'motion',
            suffix: 'Motion',
            attributes: true,
            command: false
        })

        // If doorbell publish doorbell sensor
        if (this.camera.isDoorbot) {
            this.publishCapability({
                type: 'ding',
                component: 'binary_sensor',
                className: 'occupancy',
                suffix: 'Ding',
                attributes: true,
                command: false
            })
        }

        // If camera has a light publish light component
        if (this.camera.hasLight) {
            this.publishCapability({
                type: 'light',
                component: 'light',
                suffix: 'Light',
                attributes: false,
                command: 'command'
            })
        }

        // If camera has a siren publish switch component
        if (this.camera.hasSiren) {
            this.publishCapability({
                type: 'siren',
                component: 'switch',
                suffix: 'Siren',
                attributes: false,
                command: 'command'
            })
        }

        // Publish info sensor for camera
        this.publishCapability({
            type: 'info',
            component: 'sensor',
            suffix: 'Info',
            attributes: false,
            command: false
        })

        // If snapshots enabled, publish snapshot capability
        if (this.snapshot.motion || this.snapshot.interval) {
            this.publishCapability({
                type: 'snapshot',
                component: 'camera',
                suffix: 'Snapshot',
                attributes: true,
                command: 'interval'
            })
        }
        
        // Give Home Assistant time to configure device before sending first state data
        await utils.sleep(2)
        await this.online()

        // Publish device state and, if new device, subscribe for state updates
        if (!this.subscribed) {
            this.subscribed = true
 
            // Update motion properties with most recent historical event data
            const lastMotionEvent = (await this.camera.getEvents({ limit: 1, kind: 'motion'})).events[0]
            const lastMotionDate = (lastMotionEvent && lastMotionEvent.hasOwnProperty('created_at')) ? new Date(lastMotionEvent.created_at) : false
            this.motion.last_ding = lastMotionDate ? Math.floor(lastMotionDate/1000) : 0
            this.motion.last_ding_time = lastMotionDate ? utils.getISOTime(lastMotionDate) : ''
            if (lastMotionEvent && lastMotionEvent.hasOwnProperty('cv_properties')) {
                this.motion.is_person = (lastMotionEvent.cv_properties.detection_type === 'human') ? true : false
            }

            // Update motion properties with most recent historical event data
            if (this.camera.isDoorbot) {
                const lastDingEvent = (await this.camera.getEvents({ limit: 1, kind: 'ding'})).events[0]
                const lastDingDate = (lastDingEvent && lastDingEvent.hasOwnProperty('created_at')) ? new Date(lastDingEvent.created_at) : false
                this.ding.last_ding = lastDingDate ? Math.floor(lastDingDate/1000) : 0
                this.ding.last_ding_time = lastDingDate ? utils.getISOTime(lastDingDate) : ''
            }

            // Subscribe to Ding events (all cameras have at least motion events)
            this.camera.onNewDing.subscribe(ding => {
                this.processDing(ding)
            })
            this.publishDingStates()

            // Subscribe to poll events, default every 20 seconds
            this.camera.onData.subscribe(() => {
                this.publishPolledState()
            })

            // Publish snapshot if enabled
            if (this.snapshot.motion || this.snapshot.interval > 0) {
                this.refreshSnapshot()
                // If interval based snapshots are enabled, start snapshot refresh loop
                if (this.snapshot.interval > 0) {
                    this.scheduleSnapshotRefresh()
                }
            }

            // Start monitor of availability state for camera
            this.schedulePublishInfo()
            this.monitorCameraConnection()
        } else {
            // Set states to force republish
            this.publishedLightState = this.camera.hasLight ? 'republish' : 'none'
            this.publishedSirenState = this.camera.hasSiren ? 'republish' : 'none'

            // Republish all camera state data
            this.publishDingStates()
            this.publishPolledState()

            // Publish snapshot image if any snapshot option is enabled
            if (this.snapshot.motion || this.snapshot.interval) {
                this.publishSnapshot()
            }     

            this.publishInfoState()
            this.publishAvailabilityState()
        }
    }

    // Publish state messages via MQTT with optional debug
    publishMqtt(topic, message, enableDebug) {
        if (enableDebug) debug(topic, message)
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
        } else {
            message.state_topic = componentTopic+'/state'
        }

        if (capability.attributes) { message.json_attributes_topic = componentTopic+'/attributes' }
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

    // Process a ding event
    async processDing(ding) {
        // Is it a motion or doorbell ding? (for others we do nothing)
        if (ding.kind !== 'ding' && ding.kind !== 'motion') { return }
        debug('Camera '+this.deviceId+' received '+this[ding.kind].name+' ding at '+Math.floor(ding.now)+', expires in '+ding.expires_in+' seconds')

        // Is this a new Ding or refresh of active ding?
        const newDing = (!this[ding.kind].active_ding) ? true : false
        this[ding.kind].active_ding = true

        // Update last_ding, duration and expire time
        this[ding.kind].last_ding = Math.floor(ding.now)
        this[ding.kind].last_ding_time = utils.getISOTime(ding.now*1000)
        this[ding.kind].ding_duration = ding.expires_in
        this[ding.kind].last_ding_expires = this[ding.kind].last_ding+ding.expires_in

        // If motion ding and snapshots on motion are enabled, publish a new snapshot
        if (ding.kind === 'motion') {
            this[ding.kind].is_person = (ding.detection_type === 'human') ? true : false
            if (this.snapshot.motion) {
                this.refreshSnapshot()
            }
        }

        // Publish MQTT active sensor state
        // Will republish to MQTT for new dings even if ding is already active
        this.publishDingState(ding.kind)

        // If new ding, begin expiration loop (only needed for first ding as others just extend time)
        if (newDing) {
            // Loop until current time is > last_ding expires time.  Sleeps until
            // estimated expire time, but may loop if new dings increase last_ding_expires
            while (Math.floor(Date.now()/1000) < this[ding.kind].last_ding_expires) {
                const sleeptime = (this[ding.kind].last_ding_expires - Math.floor(Date.now()/1000)) + 1
                await utils.sleep(sleeptime)
            }
            // All dings have expired, set ding state back to false/off and publish
            debug('All '+this[ding.kind].name+' dings for camera '+this.deviceId+' have expired')
            this[ding.kind].active_ding = false
            this.publishDingState(ding.kind)
        }
    }

    // Publishes all current ding states for this camera
    publishDingStates() {
        this.publishDingState('motion')
        if (this.camera.isDoorbot) { 
            this.publishDingState('ding') 
        }
    }

    // Publish ding state and attributes
    publishDingState(dingKind) {
        const dingTopic = this.cameraTopic+'/'+dingKind
        const dingState = this[dingKind].active_ding ? 'ON' : 'OFF'
        const attributes = {}
        if (dingKind === 'motion') {
            attributes.lastMotion = this[dingKind].last_ding
            attributes.lastMotionTime = this[dingKind].last_ding_time
            attributes.personDetected = this[dingKind].is_person
        } else {
            attributes.lastDing = this[dingKind].last_ding
            attributes.lastDingTime = this[dingKind].last_ding_time
        }
        this.publishMqtt(dingTopic+'/state', dingState, true)
        this.publishMqtt(dingTopic+'/attributes', JSON.stringify(attributes), true)
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    async publishPolledState() {
        // Reset heartbeat counter on every polled state and set device online if not already
        this.heartbeat = 3
        if (this.availabilityState !== 'online') { 
            await this.online() 
        }        

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

        // Update snapshot frequency in case it's changed
        if (this.snapshot.autoInterval && this.camera.data.settings.hasOwnProperty('lite_24x7')) {
            this.snapshot.interval = this.camera.data.settings.lite_24x7.frequency_secs
        }
    }

    // Publish device data to info topic
    async publishInfoState() {
        const deviceHealth = await this.camera.getHealth()
        
        if (deviceHealth) {
            const attributes = {}
            if (this.camera.hasBattery) {
                attributes.batteryLevel = deviceHealth.battery_percentage
            }
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            if (deviceHealth.network_connection && deviceHealth.network_connection === 'ethernet') {
                attributes.wiredNetwork = this.camera.data.alerts.connection
            } else {
                attributes.wirelessNetwork = deviceHealth.wifi_name
                attributes.wirelessSignal = deviceHealth.latest_signal_strength
            }            
            this.publishMqtt(this.cameraTopic+'/info/state', JSON.stringify(attributes), true)
        }
    }

    async refreshSnapshot() {
        let newSnapshot
        try {
            newSnapshot = await this.getRefreshedSnapshot()
        } catch(e) {
            debug(e.message)
        }
        if (newSnapshot && newSnapshot === 'SnapFromStream') {
            // Livestream snapshots publish asyncronously from the stream so just return
            return
        } else if (newSnapshot) {
            this.snapshot.imageData = newSnapshot
            this.snapshot.timestamp = Math.round(Date.now()/1000)
            this.publishSnapshot()
        } else {
            debug('Could not retrieve updated snapshot for camera '+this.deviceId)
        }
    }

    // Publish snapshot image/metadata
    async publishSnapshot() {
        debug(this.cameraTopic+'/snapshot/image', '<binary_image_data>')
        this.publishMqtt(this.cameraTopic+'/snapshot/image', this.snapshot.imageData)
        this.publishMqtt(this.cameraTopic+'/snapshot/attributes', JSON.stringify({ timestamp: this.snapshot.timestamp }))
    }

    // This function uses various methods to get a snapshot to work around limitations
    // of Ring API, ring-client-api snapshot caching, battery cameras, etc.
    async getRefreshedSnapshot() {
        if (this.camera.snapshotsAreBlocked) {
            debug('Snapshots are unavailable for camera '+this.deviceId+', check if motion capture is disabled manually or via modes settings')
            return false
        }

        if (this.motion.active_ding) {
            if (!this.camera.operatingOnBattery) {
                // Battery powered cameras can't take snapshots while recording, try to get image from video stream instead
                debug('Motion event detected on battery powered camera '+this.deviceId+' snapshot will be updated asynchronouly from live stream')
                this.getSnapshotFromStream()
                return 'SnapFromStream'
            } else {
                // Line powered cameras can take a snapshot while recording, but ring-client-api will return a cached
                // snapshot if a previous snapshot was taken within 10 seconds. If a motion event occurs during this time
                // a stale image is returned so we call our local function to force an uncached snapshot.
                debug('Motion event detected for line powered camera '+this.deviceId+', forcing a non-cached snapshot update')
                return await this.getUncachedSnapshot()
            }
        } else {
            // If not an active ding it's a scheduled refresh, just call getSnapshot()
            return await this.camera.getSnapshot()
        }
    }

    // Bypass ring-client-api cached snapshot behavior by calling refresh snapshot API directly
    async getUncachedSnapshot() {
        await this.camera.requestSnapshotUpdate()
        await utils.sleep(1)
        const newSnapshot = await this.camera.restClient.request({
            url: clientApi(`snapshots/image/${this.camera.id}`),
            responseType: 'buffer',
        })
        return newSnapshot
    }

    // Refresh snapshot on scheduled interval
    async scheduleSnapshotRefresh() {
        await utils.sleep(this.snapshot.interval)
        // During active motion events or device offline state, stop interval snapshots
        if (this.snapshot.motion && !this.motion.active_ding && this.availabilityState === 'online') { 
            this.refreshSnapshot()
        }
        this.scheduleSnapshotRefresh()
    }

    async getSnapshotFromStream() {
        // This is trigger P2J to publish one new snapshot from the stream
        this.livestream.updateSnapshot = true
        if (!this.livestream.active) {
            // Start a livestream if no current stream
            this.startLiveStream()
        } else {
            // Extend existing livestream if already active
            this.livestream.expires = Math.floor(Date.now()/1000) + this.livestream.duration
        }
    }

    // Start P2J server to emit complete JPEG images from livestream
    async startP2J() {
        const p2j = new P2J()
        const p2jPort = await getPort()

        let p2jServer = net.createServer(function(p2jStream) {
            p2jStream.pipe(p2j)

            // Close the p2j server on stream end
            p2jStream.on('end', function() {
                p2jServer.close()
            })
        })

        // Listen to pipe on localhost only
        p2jServer.listen(p2jPort, 'localhost')
      
        p2j.on('jpeg', (jpegFrame) => {
            // If updateSnapshot = true then publish the next full JPEG frame as new snapshot
            if (this.livestream.updateSnapshot) {
                this.snapshot.imageData = jpegFrame
                this.snapshot.timestamp = Math.round(Date.now()/1000)
                this.publishSnapshot()
                this.livestream.updateSnapshot = false
            }
        })

        // Return TCP port for SIP stream to send stream
        return p2jPort
    }

    // Start a live stream and send mjpeg stream to p2j server
    async startLiveStream() {
        if (this.livestream.active) {
            debug ('Live stream is already in progress for camera '+this.deviceId)
            return
        }
        this.livestream.active = true

        // Start a P2J pipeline and server and get the listening TCP port
        const p2jPort = await this.startP2J()
        
        // Start livestream with MJPEG output directed to P2J server with one frame every 2 seconds 
        debug('Establishing connection to video stream for camera '+this.deviceId)
        try {
            const sipSession = await this.camera.streamVideo({
                output: [
                    '-y',
                    '-c:v',
                    'mjpeg',
                    '-pix_fmt',
                    'yuvj422p',
                    '-f',
                    'image2pipe',
                    '-s',
                    '640:360',
                    '-r',
                    '.5',
                    '-q:v',
                    '2',
                    'tcp://localhost:'+p2jPort
                  ]
            })

            // If stream starts, set expire time
            this.livestream.expires = Math.floor(Date.now()/1000) + this.livestream.duration

            sipSession.onCallEnded.subscribe(() => {
                debug('Video stream ended for camera '+this.deviceId)
                this.livestream.active = false
            })

            // Don't stop SIP session until current tyime > expire time
            // Expire time may be extedned by new motion events
            while (Math.floor(Date.now()/1000) < this.livestream.expires) {
                const sleeptime = (this.livestream.expires - Math.floor(Date.now()/1000)) + 1
                await utils.sleep(sleeptime)
            }

            // Stream time has expired, stop the current SIP session
            sipSession.stop()

        } catch(e) {
            debug(e)
            this.livestream.active = false
        }
    }

    // Publish heath state every 5 minutes when online
    async schedulePublishInfo() {
        await utils.sleep(this.availabilityState === 'offline' ? 60 : 300)
        if (this.availabilityState === 'online') { this.publishInfoState() }
        this.schedulePublishInfo()
    }

    // Simple heartbeat function decrements the heartbeat counter every 20 seconds.
    // Normallt the 20 second polling events reset the heartbeat counter.  If counter
    // reaches 0 it indicates that polling has stopped so device is set offline.
    // When polling resumes and heartbeat counter is reset above zero, device is set online.
    async monitorCameraConnection() {
        if (this.heartbeat > 0) {
            this.heartbeat--
        } else {
            if (this.availabilityState !== 'offline') { 
                this.offline()
            } else {
                // If camera remains offline more than one cycle, try to tickle it back alive
                this.camera.requestUpdate()
            }
        }
        
        // Check for subscription to ding and motion events and attempt to resubscribe
        if (!this.camera.data.subscribed === true) {
            debug('Camera Id '+camera.data.device_id+' lost subscription to ding events, attempting to resubscribe...')
            this.camera.subscribeToDingEvents().catch(e => { 
                debug('Failed to resubscribe camera Id ' +this.deviceId+' to ding events. Will retry in 60 seconds.') 
                debug(e)
            })
        }
        if (!this.camera.data.subscribed_motions === true) {
            debug('Camera Id '+camera.data.device_id+' lost subscription to motion events, attempting to resubscribe...')
            this.camera.subscribeToMotionEvents().catch(e => {
                debug('Failed to resubscribe camera Id '+this.deviceId+' to motion events.  Will retry in 60 seconds.')
                debug(e)
            })
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
                debug('Somehow received message to unknown state topic for camera '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setLightState(message) {
        debug('Received set light state '+message+' for camera '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        switch (message) {
            case 'ON':
                this.camera.setLight(true)
                break;
            case 'OFF':
                this.camera.setLight(false)
                break;
            default:
                debug('Received unknown command for light on camera '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    setSirenState(message) {
        debug('Received set siren state '+message+' for camera '+this.deviceId)
        debug('Location '+ this.locationId)
        switch (message) {
            case 'ON':
                this.camera.setSiren(true)
                break;
            case 'OFF':
                this.camera.setSiren(false)
                break;
            default:
                debug('Received unkonw command for light on camera '+this.deviceId)
        }
    }

    // Set refresh interval for snapshots
    setSnapshotInterval(message) {
        debug('Received set snapshot refresh interval '+message+' for camera '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
            debug ('Received invalid interval')
        } else {
            this.snapshot.interval = (message >= 10) ? Math.round(message) : 10
            this.snapshot.autoInterval = false
            debug ('Snapshot refresh interval as been set to '+this.snapshot.interval+' seconds')
        }
    }

    // Publish availability state
    publishAvailabilityState(enableDebug) {
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)

    }

    // Set state topic online
    async online() {
        const enableDebug = (this.availabilityState === 'online') ? false : true
        this.availabilityState = 'online'
        await utils.sleep(1)
        this.publishAvailabilityState(enableDebug)
        await utils.sleep(1)
    }

    // Set state topic offline
    offline() {
        const enableDebug = (this.availabilityState === 'offline') ? false : true
        this.availabilityState = 'offline'
        this.publishAvailabilityState(enableDebug)
    }
}

module.exports = Camera
