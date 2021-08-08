const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const RingPolledDevice = require('./base-polled-device')
const clientApi = require('../node_modules/ring-client-api/lib/api/rest-client').clientApi
const P2J = require('pipe2jpeg')
const net = require('net');
const getPort = require('get-port')

class Camera extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'camera')

        // Camera sepecific properties
        this.publishedLightState = this.device.hasLight ? 'publish' : 'none'
        this.publishedSirenState = this.device.hasSiren ? 'publish' : 'none'
        this.publishedMotionDetectionEnabled = 'publish'

        // Configure initial snapshot parameters based on device type and app settings
        this.snapshot = { 
            motion: false, 
            interval: false,
            intervalTimerId: null,
            autoInterval: false,
            imageData: null,
            timestamp: null,
            updating: null
        }

        if (this.config.snapshot_mode === "motion" || this.config.snapshot_mode === "interval" || this.config.snapshot_mode === "all" ) {
            this.snapshot.motion = (this.config.snapshot_mode === "motion" || this.config.snapshot_mode === "all") ? true : false

            if (this.config.snapshot_mode === "interval" || this.config.snapshot_mode === "all") {
                this.snapshot.autoInterval = true
                if (this.device.operatingOnBattery) {
                    if (this.device.data.settings.hasOwnProperty('lite_24x7') && this.device.data.settings.lite_24x7.enabled) {
                        this.snapshot.interval = this.device.data.settings.lite_24x7.frequency_secs
                    } else {
                        this.snapshot.interval = 600
                    }
                } else {
                    this.snapshot.interval = 30
                }
            }
        }

        // Define entities for this device
        this.entities = {
            motion: {
                type: 'binary_sensor',
                deviceClass: 'motion',
                attributes: true
            },
            ...this.device.isDoorbot ? {
                ding: {
                    type: 'binary_sensor',
                    deviceClass: 'occupancy',
                    attributes: true
                }
            } : {},
            ...this.device.hasLight ? {
                light: {
                    type: 'light'
                }
            } : {},
            ...this.device.hasSiren ? {
                siren: {
                    type: 'switch'
                }
            } : {},
            ...(this.snapshot.motion || this.snapshot.interval) ? { 
                snapshot: {
                    type: 'camera',
                    attributes: true
                }
            } : {},
            ...(this.snapshot.motion || this.snapshot.interval) ? {
                snapshot_interval: {
                    type: 'number',
                    min: 10,
                    max: 3600,
                    icon: 'hass:timer'
                }
            } : {},
            info: {
                type: 'sensor',
                deviceClass: 'timestamp',
                valueTemplate: '{{ value_json["lastUpdate"] | default }}'
            }
        }

        // Initialize livestream parameters
        this.livestream = {
            duration: (this.device.data.settings.video_settings.hasOwnProperty('clip_length_max') && this.device.data.settings.video_settings.clip_length_max) 
                      ? this.device.data.settings.video_settings.clip_length_max
                      : 60,
            active: false,
            expires: 0,
            updateSnapshot: false
        }
      
        // Properties for storing ding states
        this.motion = {
            name: 'motion',
            active_ding: false,
            ding_duration: 180,
            last_ding: 0,
            last_ding_expires: 0,
            last_ding_time: 'none',
            is_person: false
        }

        if (this.device.isDoorbot) {
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

        const deviceHealth = await this.device.getHealth()
        if (deviceHealth) {
            if (deviceHealth.hasOwnProperty('network_connection') && deviceHealth.network_connection === 'ethernet') {
                console.log(deviceHealth)
            } else {
                console.log(deviceHealth)
            }  
        }

        await this.publishDevice()
        await this.online()

        // Publish device state and, if new device, subscribe for state updates
        if (!this.subscribed) {
            this.subscribed = true
 
            // Update motion properties with most recent historical event data
            const lastMotionEvent = (await this.device.getEvents({ limit: 1, kind: 'motion'})).events[0]
            const lastMotionDate = (lastMotionEvent && lastMotionEvent.hasOwnProperty('created_at')) ? new Date(lastMotionEvent.created_at) : false
            this.motion.last_ding = lastMotionDate ? Math.floor(lastMotionDate/1000) : 0
            this.motion.last_ding_time = lastMotionDate ? utils.getISOTime(lastMotionDate) : ''
            if (lastMotionEvent && lastMotionEvent.hasOwnProperty('cv_properties')) {
                this.motion.is_person = (lastMotionEvent.cv_properties.detection_type === 'human') ? true : false
            }

            // Update motion properties with most recent historical event data
            if (this.device.isDoorbot) {
                const lastDingEvent = (await this.device.getEvents({ limit: 1, kind: 'ding'})).events[0]
                const lastDingDate = (lastDingEvent && lastDingEvent.hasOwnProperty('created_at')) ? new Date(lastDingEvent.created_at) : false
                this.ding.last_ding = lastDingDate ? Math.floor(lastDingDate/1000) : 0
                this.ding.last_ding_time = lastDingDate ? utils.getISOTime(lastDingDate) : ''
            }

            // Subscribe to Ding events (all cameras have at least motion events)
            this.onNewDingSubscription = this.device.onNewDing.subscribe(ding => {
                this.processDing(ding)
            })
            this.publishDingStates()

            // Subscribe to poll events, default every 20 seconds
            this.onDataSubscription = this.device.onData.subscribe(() => {
                this.publishPolledState()
            })

            // Publish snapshot if enabled
            if (this.snapshot.motion || this.snapshot.interval > 0) {
                this.refreshSnapshot()
                // If interval based snapshots are enabled, start snapshot refresh loop
                if (this.snapshot.interval > 0) {
                    this.scheduleSnapshotRefresh()
                }
                this.publishSnapshotInterval()
            }

            // Start monitor of availability state for camera
            this.schedulePublishInfo()
            this.monitorHeartbeat()
        } else {
            // Set states to force republish
            this.publishedLightState = this.device.hasLight ? 'republish' : 'none'
            this.publishedSirenState = this.device.hasSiren ? 'republish' : 'none'
            this.publishedMotionDetectionEnabled = 'republish'

            // Republish all camera state data
            this.publishDingStates()
            this.publishPolledState()

            // Publish snapshot image if any snapshot option is enabled
            if (this.snapshot.motion || this.snapshot.interval) {
                this.publishSnapshot()
                this.publishSnapshotInterval()
            }     

            this.publishInfoState()
            this.publishAvailabilityState()
        }
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
        if (this.device.isDoorbot) { 
            this.publishDingState('ding') 
        }
    }

    // Publish ding state and attributes
    publishDingState(dingKind) {
        const dingTopic = this.deviceTopic+'/'+dingKind
        const dingState = this[dingKind].active_ding ? 'ON' : 'OFF'
        this.publishMqtt(dingTopic+'/state', dingState, true)

        if (dingKind === 'motion') {
            this.publishMotionAttributes()
        } else {
            this.publishDingAttributes()
        }
    }

    publishMotionAttributes() {
        const attributes = {}
        attributes.lastMotion = this.motion.last_ding
        attributes.lastMotionTime = this.motion.last_ding_time
        attributes.personDetected = this.motion.is_person
        if (this.device.data.settings && typeof this.device.data.settings.motion_detection_enabled !== 'undefined') {
            attributes.motionDetectionEnabled = this.device.data.settings.motion_detection_enabled
            this.publishedMotionDetectionEnabled = attributes.motionDetectionEnabled
        }
        this.publishMqtt(this.deviceTopic+'/motion/attributes', JSON.stringify(attributes), true)
    }

    publishDingAttributes() {
        const attributes = {}
        attributes.lastDing = this.ding.last_ding
        attributes.lastDingTime = this.ding.last_ding_time
        this.publishMqtt(this.deviceTopic+'/ding/attributes', JSON.stringify(attributes), true)
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    async publishPolledState() {
        // Reset heartbeat counter on every polled state
        this.heartbeat = 3

        // Check for subscription to ding and motion events and attempt to resubscribe
        if (!this.device.data.subscribed === true) {
            debug('Camera Id '+this.deviceId+' lost subscription to ding events, attempting to resubscribe...')
            this.device.subscribeToDingEvents().catch(e => { 
                debug('Failed to resubscribe camera Id ' +this.deviceId+' to ding events. Will retry in 60 seconds.') 
                debug(e)
            })
        }
        if (!this.device.data.subscribed_motions === true) {
            debug('Camera Id '+this.deviceId+' lost subscription to motion events, attempting to resubscribe...')
            this.device.subscribeToMotionEvents().catch(e => {
                debug('Failed to resubscribe camera Id '+this.deviceId+' to motion events.  Will retry in 60 seconds.')
                debug(e)
            })
        }

        if (this.device.hasLight) {
            const stateTopic = this.deviceTopic+'/light/state'
            if (this.device.data.led_status !== this.publishedLightState) {
                this.publishMqtt(stateTopic, (this.device.data.led_status === 'on' ? 'ON' : 'OFF'), true)
                this.publishedLightState = this.device.data.led_status
            }
        }
        if (this.device.hasSiren) {
            const stateTopic = this.deviceTopic+'/siren/state'
            const sirenStatus = this.device.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenStatus !== this.publishedSirenState) {
                this.publishMqtt(stateTopic, sirenStatus, true)
                this.publishedSirenState = sirenStatus
            }
        }

        if (this.device.data.settings.motion_detection_enabled !== this.publishedMotionDetectionEnabled) {
            this.publishMotionAttributes()
        }
      
        // Update snapshot frequency in case it's changed
        if (this.snapshot.autoInterval && this.device.data.settings.hasOwnProperty('lite_24x7')) {
            this.snapshot.interval = this.device.data.settings.lite_24x7.frequency_secs
        }
    }

    // Publish device data to info topic
    async publishInfoState() {
        const deviceHealth = await this.device.getHealth()
        
        if (deviceHealth) {
            const attributes = {}
            if (this.device.hasBattery) {
                attributes.batteryLevel = deviceHealth.battery_percentage
            }
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            if (deviceHealth.hasOwnProperty('network_connection') && deviceHealth.network_connection === 'ethernet') {
                attributes.wiredNetwork = this.device.data.alerts.connection
            } else {
                attributes.wirelessNetwork = deviceHealth.wifi_name
                attributes.wirelessSignal = deviceHealth.latest_signal_strength
            }            
            this.publishMqtt(this.deviceTopic+'/info/state', JSON.stringify(attributes), true)
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
            // Livestream snapshots publish automatically from the stream so just return
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
        debug(this.deviceTopic+'/snapshot/image', '<binary_image_data>')
        this.publishMqtt(this.deviceTopic+'/snapshot/image', this.snapshot.imageData)
        this.publishMqtt(this.deviceTopic+'/snapshot/attributes', JSON.stringify({ timestamp: this.snapshot.timestamp }))
    }

    async publishSnapshotInterval() {
        this.publishMqtt(this.deviceTopic+'/snapshot_interval/state', this.snapshot.interval.toString(), true)
    }

    // This function uses various methods to get a snapshot to work around limitations
    // of Ring API, ring-client-api snapshot caching, battery cameras, etc.
    async getRefreshedSnapshot() {
        if (this.device.snapshotsAreBlocked) {
            debug('Snapshots are unavailable for camera '+this.deviceId+', check if motion capture is disabled manually or via modes settings')
            return false
        }

        if (this.motion.active_ding) {
            if (this.device.operatingOnBattery) {
                // Battery powered cameras can't take snapshots while recording, try to get image from video stream instead
                debug('Motion event detected on battery powered camera '+this.deviceId+' snapshot will be updated from live stream')
                this.getSnapshotFromStream()
                return 'SnapFromStream'
            } else {
                // Line powered cameras can take a snapshot while recording, but ring-client-api will return a cached
                // snapshot if a previous snapshot was taken within 10 seconds. If a motion event occurs during this time
                // a stale image would be returned so, instead, we call our local function to force an uncached snapshot.
                debug('Motion event detected for line powered camera '+this.deviceId+', forcing a non-cached snapshot update')
                return await this.getUncachedSnapshot()
            }
        } else {
            // If not an active ding it's a scheduled refresh, just call getSnapshot()
            return await this.device.getSnapshot()
        }
    }

    // Bypass ring-client-api cached snapshot behavior by calling refresh snapshot API directly
    async getUncachedSnapshot() {
        await this.device.requestSnapshotUpdate()
        await utils.sleep(1)
        const newSnapshot = await this.device.restClient.request({
            url: clientApi(`snapshots/image/${this.device.id}`),
            responseType: 'buffer',
        })
        return newSnapshot
    }

    // Refresh snapshot on scheduled interval
    async scheduleSnapshotRefresh() {
            this.snapshot.intervalTimerId = setInterval(() => {
                if (this.snapshot.motion && !this.motion.active_ding && this.availabilityState === 'online') {
                    this.refreshSnapshot()
                }
            }, this.snapshot.interval * 1000)
    }

    async getSnapshotFromStream() {
        // This will trigger P2J to publish one new snapshot from the live stream
        this.livestream.updateSnapshot = true

        // If there's no active live stream, start it, otherwise, extend live stream timeout
        if (!this.livestream.active) {
            this.startLiveStream()
        } else {
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
        this.livestream.active = true

        // Start a P2J pipeline and server and get the listening TCP port
        const p2jPort = await this.startP2J()
        
        // Start livestream with MJPEG output directed to P2J server with one frame every 2 seconds 
        debug('Establishing connection to video stream for camera '+this.deviceId)
        try {
            const sipSession = await this.device.streamVideo({
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

            // If stream starts, set expire time, may be extended by new events
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
            case 'snapshot_interval':
                this.setSnapshotInterval(message)
                break;
            default:
                debug('Somehow received message to unknown state topic for camera '+this.deviceId)
        }
    }

    // Set switch target state on received MQTT command message
    async setLightState(message) {
        debug('Received set light state '+message+' for camera '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
                await this.device.setLight(true)
                break;
            case 'off':
                await this.device.setLight(false)
                break;
            default:
                debug('Received unknown command for light on camera '+this.deviceId)
        }
        await utils.sleep(1)
        this.device.requestUpdate()
    }

    // Set switch target state on received MQTT command message
    async setSirenState(message) {
        debug('Received set siren state '+message+' for camera '+this.deviceId)
        debug('Location '+ this.locationId)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
                await this.device.setSiren(true)
                break;
            case 'off':
                await this.device.setSiren(false)
                break;
            default:
                debug('Received unkonw command for light on camera '+this.deviceId)
        }
        await utils.sleep(1)
        this.device.requestUpdate()
    }

    // Set refresh interval for snapshots
    setSnapshotInterval(message) {
        debug('Received set snapshot refresh interval '+message+' for camera '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (isNaN(message)) {
            debug ('Snapshot interval value received but not a number')
        } else if (!(message >= 10 && message <= 3600)) {
            debug('Snapshot interval value received but out of range (10-3600)')
        } else {
            this.snapshot.interval = Math.round(message)
            this.snapshot.autoInterval = false
            debug ('Snapshot refresh interval as been set to '+this.snapshot.interval+' seconds')
            this.publishSnapshotInterval()
            clearTimeout(this.snapshot.intervalTimerId)
            this.scheduleSnapshotRefresh()
        }
    }
}

module.exports = Camera