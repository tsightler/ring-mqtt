const debug = require('debug')('ring-mqtt')
const utils = require( '../lib/utils' )
const colors = require('colors/safe')
const RingPolledDevice = require('./base-polled-device')
const { clientApi } = require('../node_modules/ring-client-api/lib/api/rest-client')
const P2J = require('pipe2jpeg')
const net = require('net');
const getPort = require('get-port')
const pathToFfmpeg = require('ffmpeg-for-homebridge')
const { spawn } = require('child_process')
const ip = require("ip");

class Camera extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo)

        this.data = {
            motion: {
                active_ding: false,
                ding_duration: 180,
                last_ding: 0,
                last_ding_expires: 0,
                last_ding_time: 'none',
                is_person: false
            },
            ... this.device.isDoorbot ? { 
                ding: {
                    active_ding: false,
                    ding_duration: 180,
                    last_ding: 0,
                    last_ding_expires: 0,
                    last_ding_time: 'none'
                } 
            } : {},
            snapshot: {
                autoInterval: false,
                currentImage: null,
                interval: false,
                intervalTimerId: null,
                motion: false, 
                timestamp: null
            },
            stream: {
                duration: (this.device.data.settings.video_settings.hasOwnProperty('clip_length_max') && this.device.data.settings.video_settings.clip_length_max) 
                    ? this.device.data.settings.video_settings.clip_length_max
                    : 60,
                active: false,
                expires: 0,
                updateSnapshot: false,
                sipSession: null,
                stillImageURL: `http://localhost:8123{{ states.camera.${this.device.name.toLowerCase().replace(" ","_")}_snapshot.attribute.entity_picture }}`,
                streamSource: `rtsp://${ip.address()}:8554/${this.deviceId}_live`
            },
            lightState: null,
            sirenState: null,
            motionDetectionEnabled: null
        }

        if (this.config.snapshot_mode.match(/^(motion|interval|all)$/)) {
            this.data.snapshot.motion = (this.config.snapshot_mode.match(/^(motion|all)$/)) ? true : false

            if (this.config.snapshot_mode.match(/^(interval|all)$/)) {
                this.data.snapshot.autoInterval = true
                if (this.device.operatingOnBattery) {
                    if (this.device.data.settings.hasOwnProperty('lite_24x7') && this.device.data.settings.lite_24x7.enabled) {
                        this.data.snapshot.interval = this.device.data.settings.lite_24x7.frequency_secs
                    } else {
                        this.data.snapshot.interval = 600
                    }
                } else {
                    this.data.snapshot.interval = 30
                }
            }
        }
      
        this.entity = {
            ...this.entity,
            motion: {
                component: 'binary_sensor',
                device_class: 'motion',
                attributes: true,
            },
            stream: {
                component: 'switch',
                attributes: true,
                icon: 'mdi:cctv'
            },
            ...this.device.isDoorbot ? {
                ding: {
                    component: 'binary_sensor',
                    device_class: 'occupancy',
                    attributes: true,
                    icon: 'mdi:doorbell-video'
                }
            } : {},
            ...this.device.hasLight ? {
                light: {
                    component: 'light'
                }
            } : {},
            ...this.device.hasSiren ? {
                siren: {
                    component: 'switch',
                    icon: 'mdi:alarm-light'
                }
            } : {},
            ...(this.data.snapshot.motion || this.data.snapshot.interval) ? { 
                snapshot: {
                    component: 'camera',
                    attributes: true
                }
            } : {},
            ...(this.data.snapshot.motion || this.data.snapshot.interval) ? {
                snapshot_interval: {
                    component: 'number',
                    min: 10,
                    max: 3600,
                    icon: 'hass:timer'
                }
            } : {},
            info: {
                component: 'sensor',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default }}'
            }
        }

        this.onNewDingSubscription = this.device.onNewDing.subscribe(ding => {
            if (this.isOnline()) { this.processDing(ding) }
        })

        if (this.data.snapshot.interval > 0) {
            this.scheduleSnapshotRefresh()
        }

    }

    // Build standard and optional entities for device
    async initAttributeEntities() {
         // If device is wireless publish signal strength entity
        const deviceHealth = await this.device.getHealth()
        if (deviceHealth && !(deviceHealth.hasOwnProperty('network_connection') && deviceHealth.network_connection === 'ethernet')) {
            this.entity.wireless = {
                component: 'sensor',
                device_class: 'signal_strength',
                unit_of_measurement: 'dBm',
                parent_state_topic: 'info/state',
                attributes: 'wireless',
                value_template: '{{ value_json["wirelessSignal"] | default }}'
            }
        }

        // If device is battery powered publish battery entity
        if (this.device.hasBattery) {
            this.entity.battery = {
                component: 'sensor',
                device_class: 'battery',
                unit_of_measurement: '%',
                state_class: 'measurement',
                parent_state_topic: 'info/state',
                attributes: 'battery',
                value_template: '{{ value_json["batteryLevel"] | default }}'
            }
        }

        // Update motion properties with most recent historical event data
        const lastMotionEvent = (await this.device.getEvents({ limit: 1, kind: 'motion'})).events[0]
        const lastMotionDate = (lastMotionEvent && lastMotionEvent.hasOwnProperty('created_at')) ? new Date(lastMotionEvent.created_at) : false
        this.data.motion.last_ding = lastMotionDate ? Math.floor(lastMotionDate/1000) : 0
        this.data.motion.last_ding_time = lastMotionDate ? utils.getISOTime(lastMotionDate) : ''
        if (lastMotionEvent && lastMotionEvent.hasOwnProperty('cv_properties')) {
            this.data.motion.is_person = (lastMotionEvent.cv_properties.detection_type === 'human') ? true : false
        }

        // Update motion properties with most recent historical event data
        if (this.device.isDoorbot) {
            const lastDingEvent = (await this.device.getEvents({ limit: 1, kind: 'ding'})).events[0]
            const lastDingDate = (lastDingEvent && lastDingEvent.hasOwnProperty('created_at')) ? new Date(lastDingEvent.created_at) : false
            this.data.ding.last_ding = lastDingDate ? Math.floor(lastDingDate/1000) : 0
            this.data.ding.last_ding_time = lastDingDate ? utils.getISOTime(lastDingDate) : ''
        }
    }

    // Publish camera capabilities and state and subscribe to events
    async publishData(data) {
        const isPublish = data === undefined ? true : false
        this.publishPolledState(isPublish)

        if (isPublish) {
            // Publish stream state
            this.publishMqtt(this.entity.stream.state_topic, this.data.stream.active ? 'ON' : 'OFF', true)
 
            this.publishDingStates()
            if (this.data.snapshot.motion || this.data.snapshot.interval) {
                this.data.snapshot.currentImage ? this.publishSnapshot() : this.refreshSnapshot()
                if (this.data.snapshot.interval) {
                    this.publishSnapshotInterval(isPublish)
                }
            }
            this.publishAttributes()
        }

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
    }
    
    // Process a ding event
    async processDing(ding) {
        // Is it a motion or doorbell ding? (for others we do nothing)
        if (ding.kind !== 'ding' && ding.kind !== 'motion') { return }
        debug(`Camera ${this.deviceId} received ${ding.kind === 'ding' ? 'doorbell' : 'motion'} ding at ${Math.floor(ding.now)}, expires in ${ding.expires_in} seconds`)

        // Is this a new Ding or refresh of active ding?
        const newDing = (!this.data[ding.kind].active_ding) ? true : false
        this.data[ding.kind].active_ding = true

        // Update last_ding, duration and expire time
        this.data[ding.kind].last_ding = Math.floor(ding.now)
        this.data[ding.kind].last_ding_time = utils.getISOTime(ding.now*1000)
        this.data[ding.kind].ding_duration = ding.expires_in
        this.data[ding.kind].last_ding_expires = this.data[ding.kind].last_ding+ding.expires_in

        // If motion ding and snapshots on motion are enabled, publish a new snapshot
        if (ding.kind === 'motion') {
            this.data[ding.kind].is_person = (ding.detection_type === 'human') ? true : false
            if (this.data.snapshot.motion) {
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
            while (Math.floor(Date.now()/1000) < this.data[ding.kind].last_ding_expires) {
                const sleeptime = (this.data[ding.kind].last_ding_expires - Math.floor(Date.now()/1000)) + 1
                await utils.sleep(sleeptime)
            }
            // All dings have expired, set ding state back to false/off and publish
            debug(`All ${ding.kind === 'ding' ? 'doorbell' : 'motion'} dings for camera ${this.deviceId} have expired`)
            this.data[ding.kind].active_ding = false
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
        const dingState = this.data[dingKind].active_ding ? 'ON' : 'OFF'
        this.publishMqtt(this.entity[dingKind].state_topic, dingState, true)

        if (dingKind === 'motion') {
            this.publishMotionAttributes()
        } else {
            this.publishDingAttributes()
        }
    }

    publishMotionAttributes() {
        const attributes = {
            lastMotion: this.data.motion.last_ding,
            lastMotionTime: this.data.motion.last_ding_time,
            personDetected: this.data.motion.is_person
        }
        if (this.device.data.settings && typeof this.device.data.settings.motion_detection_enabled !== 'undefined') {
            this.data.motionDetectionEnabled = this.device.data.settings.motion_detection_enabled
            attributes.motionDetectionEnabled = this.data.motionDetectionEnabled
        }
        this.publishMqtt(this.entity.motion.json_attributes_topic, JSON.stringify(attributes), true)
    }

    publishDingAttributes() {
        const attributes = {
            lastDing: this.data.ding.last_ding,
            lastDingTime: this.data.ding.last_ding_time
        }
        this.publishMqtt(this.entity.ding.json_attributes_topic, JSON.stringify(attributes), true)
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    async publishPolledState(isPublish) {
        if (this.device.hasLight) {
            const lightState = this.device.data.led_status === 'on' ? 'ON' : 'OFF'
            if (lightState !== this.data.lightState || isPublish) {
                this.data.lightState = lightState
                this.publishMqtt(this.entity.light.state_topic, this.data.lightState, true)
            }
        }
        if (this.device.hasSiren) {
            const sirenState = this.device.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenState !== this.data.sirenState || isPublish) {
                this.data.sirenState = sirenState
                this.publishMqtt(this.entity.siren.state_topic, this.data.sirenState, true)
            }
        }

        if (this.device.data.settings.motion_detection_enabled !== this.data.motionDetectionEnabled || isPublish) {
            this.publishMotionAttributes()
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
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
            attributes.stream_Source = this.data.stream.streamSource
            attributes.still_Image_URL = this.data.stream.stillImageURL
            this.publishMqtt(this.entity.info.state_topic, JSON.stringify(attributes), true)
            this.publishAttributeEntities(attributes)
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
            // Snapshots from active stream publish automatically so just return
            return
        } else if (newSnapshot) {
            this.data.snapshot.currentImage = newSnapshot
            this.data.snapshot.timestamp = Math.round(Date.now()/1000)
            this.publishSnapshot()
        } else {
            debug('Could not retrieve updated snapshot for camera '+this.deviceId)
        }
    }

    // Publish snapshot image/metadata
    async publishSnapshot() {
        debug(colors.green(`[${this.deviceData.name}]`)+' '+colors.blue(`${this.entity.snapshot.topic}`)+' '+colors.cyan('<binary_image_data>'))
        this.publishMqtt(this.entity.snapshot.topic, this.data.snapshot.currentImage)
        this.publishMqtt(this.entity.snapshot.json_attributes_topic, JSON.stringify({ timestamp: this.data.snapshot.timestamp }))
    }

    async publishSnapshotInterval(isPublish) {
        if (isPublish) {
            this.publishMqtt(this.entity.snapshot_interval.state_topic, this.data.snapshot.interval.toString(), true)
        } else {
            // Update snapshot frequency in case it's changed
            if (this.data.snapshot.autoInterval && this.data.snapshot.interval !== this.device.data.settings.lite_24x7.frequency_secs) {
                this.data.snapshot.interval = this.device.data.settings.lite_24x7.frequency_secs
                clearTimeout(this.data.snapshot.intervalTimerId)
                this.scheduleSnapshotRefresh()
            }
            this.publishMqtt(this.entity.snapshot_interval.state_topic, this.data.snapshot.interval.toString(), true)
        }
    }

    // This function uses various methods to get a snapshot to work around limitations
    // of Ring API, ring-client-api snapshot caching, battery cameras, etc.
    async getRefreshedSnapshot() {
        if (this.device.snapshotsAreBlocked) {
            debug('Snapshots are unavailable for camera '+this.deviceId+', check if motion capture is disabled manually or via modes settings')
            return false
        }

        if (this.data.motion.active_ding) {
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
            this.data.snapshot.intervalTimerId = setInterval(() => {
                if (this.isOnline() && this.data.snapshot.interval && !(this.data.snapshot.motion && this.data.motion.active_ding)) {
                    this.refreshSnapshot()
                }
            }, this.data.snapshot.interval * 1000)
    }

    async getSnapshotFromStream() {
        // This will trigger P2J to publish one new snapshot from the live stream
        this.data.stream.updateSnapshot = true

        // If there's no active live stream, start it, otherwise, extend live stream timeout
        if (!this.data.stream.active) {
            this.startSnapshotStream()
        } else {
            this.data.stream.expires = Math.floor(Date.now()/1000) + this.data.stream.duration
        }
    }

    // Start P2J server to extract and publish JPEG images from stream
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
            if (this.data.stream.updateSnapshot) {
                this.data.snapshot.currentImage = jpegFrame
                this.data.snapshot.timestamp = Math.round(Date.now()/1000)
                this.publishSnapshot()
            }
        })

        // Return TCP port for SIP stream to send stream
        return p2jPort
    }

    async startSnapshotStream() {
        // Start a P2J pipeline and server and get the listening TCP port
        const p2jPort = await this.startP2J()
        
        // Start stream with MJPEG output directed to P2J server with one frame every 2 seconds 
        debug('Starting the MJPEG snapshot stream for camera '+this.deviceId)

        const ffmpegProcess = spawn(pathToFfmpeg, [
            '-i',
            `rtsp://localhost:8554/${this.deviceId}_live`,
            '-c:v',
            'mjpeg',
            '-pix_fmt',
            'yuvj422p',
            '-f',
            'image2pipe',
            '-s',
            '640:360',
            '-r',
            '.1',
            '-q:v',
            '2',
            `tcp://localhost:+${p2jPort}`
        ])

        ffmpegProcess.on('spawn', async () => {
            debug(`The MJPEG snapshot stream snapshots for camera ${this.deviceId} has started`)
        })

        ffmpegProcess.on('close', async (code) => {
            debug(`The MJPEG snapshot stream snapshots for camera ${this.deviceId} has stopped`)
        })

        // If stream starts, set expire time, may be extended by new events
        this.data.stream.expires = Math.floor(Date.now()/1000) + this.data.stream.duration

        // Don't stop MJPEG session until current time > expire time
        // Expire time could be extended by additional motion events, except 
        // Ring devices don't send motion events while a stream is active so
        // it won't ever happen!
        while (Math.floor(Date.now()/1000) < this.data.stream.expires) {
            const sleeptime = (this.data.stream.expires - Math.floor(Date.now()/1000)) + 1
            await utils.sleep(sleeptime)
        }

        ffmpegProcess.kill()
        this.data.stream.updateSnapshot = false
    }

    async setStreamState(message) {
        debug('Received set stream state '+message+' for camera '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
                if (this.data.stream.active === true) {
                    this.publishMqtt(this.entity.stream.state_topic, this.data.stream.active ? 'ON' : 'OFF', true)
                    return
                }
                this.data.stream.active = true
                
                // Start and publish stream to rtsp-simple-server 
                debug('Establishing connection to video stream for camera '+this.deviceId)
                try {
                    this.data.stream.sipSession = await this.device.streamVideo({
                        audio: [], video: [],
                        output: [ '-acodec', 'aac', '-vcodec', 'copy', '-f', 'flv', `rtmp://localhost:1935/${this.deviceId}_live` ]
                    })
                    this.publishMqtt(this.entity.stream.state_topic, this.data.stream.active ? 'ON' : 'OFF', true)

                    this.data.stream.sipSession.onCallEnded.subscribe(() => {
                        debug('Video stream ended for camera '+this.deviceId)
                        this.data.stream.active = false
                        this.publishMqtt(this.entity.stream.state_topic, this.data.stream.active ? 'ON' : 'OFF', true)
                        this.data.stream.sipSession = false
                    })
                } catch(e) {
                    debug(e)
                    this.data.stream.active = false
                    this.publishMqtt(this.entity.stream.state_topic, this.data.stream.active ? 'ON' : 'OFF', true)
                }
                break;
            case 'off':
                if (this.data.stream.sipSession) {
                    this.data.stream.sipSession.stop()
                } else {
                    this.publishMqtt(this.entity.stream.state_topic, this.data.stream.active ? 'ON' : 'OFF', true)
                }
                break;
            default:
                debug('Received unknown command for stream on camera '+this.deviceId)
        }
    }

    // Process messages from MQTT command topic
    processCommand(message, componentCommand) {
        const entityKey = componentCommand.split('/')[0]
        switch (componentCommand) {
            case 'light/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setLightState(message)
                }
                break;
            case 'siren/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setSirenState(message)
                }
                break;
            case 'snapshot/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setSnapshotInterval(message)
                }
                break;
            case 'snapshot_interval/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setSnapshotInterval(message)
                }
                break;
            case 'stream/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setStreamState(message)
                }
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
            this.data.snapshot.interval = Math.round(message)
            this.data.snapshot.autoInterval = false
            clearTimeout(this.data.snapshot.intervalTimerId)
            this.scheduleSnapshotRefresh()
            this.publishSnapshotInterval()
            debug ('Snapshot refresh interval has been set to '+this.data.snapshot.interval+' seconds')
        }
    }
}

module.exports = Camera