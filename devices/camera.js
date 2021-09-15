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
const rss = require('../lib/rtsp-simple-server')

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
                is_person: false,
                detection_enabled: null
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
                timestamp: null,
                update: false
            },
            stream: {
                duration: (this.device.data.settings.video_settings.hasOwnProperty('clip_length_max') && this.device.data.settings.video_settings.clip_length_max) 
                    ? this.device.data.settings.video_settings.clip_length_max
                    : 60,
                state: 'OFF',
                status: 'inactive',
                expires: 0,
                snapshot: { 
                    active: false,
                    expires: 0
                },
                keepalive:{ 
                    active: false, 
                    expires: 0
                },
                liveSession: false,
                recordedSession: false,
                rtspPublishUrl: (this.config.livestream_user && this.config.livestream_pass)
                    ? `rtsp://${this.config.livestream_user}:${this.config.livestream_pass}@localhost:8554/${this.deviceId}_live`
                    : `rtsp://localhost:8554/${this.deviceId}_live`
    
            },
            stream_select: {
                state: 'Live',
                publishedState: null
            },
            ...this.device.hasLight ? {
                light: {
                    state: null
                }
            } : {},
            ...this.device.hasSiren ? {
                siren: {
                    state:null
                }
            } : {}
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
            stream_select: {
                component: 'select',
                options: [
                    'Live',
                    ...(this.device.isDoorbot
                        ? [ 'Ding 1', 'Ding 2', 'Ding 3', 'Ding 4', 'Ding 5' ]
                        : []),
                    'Motion 1', 'Motion 2', 'Motion 3', 'Motion 4', 'Motion 5',
                    'On-demand 1', 'On-demand 2', 'On-demand 3', 'On-demand 4', 'On-demand 5'
                ]
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
            ...(this.data.snapshot.interval) ? {
                snapshot_interval: {
                    component: 'number',
                    min: 10,
                    max: 604800,
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

        let stillImageUrlBase = 'localhost'
        let streamSourceUrlBase
        if (process.env.RUNMODE === 'addon') {
            // For the addon we get some values populated from the startup script
            // that queries the HA API via bashio
            stillImageUrlBase = process.env.HAHOSTNAME
            streamSourceUrlBase = process.env.ADDONHOSTNAME
        } else if (process.env.RUNMODE === 'docker') {
            // For docker we don't have any API to query so we just use the IP of the docker container
            // since it probably doesn't have a DNS entry
            streamSourceUrlBase = await utils.getHostIp()
        } else {
            // For the stadalone install we try to get the host FQDN
            streamSourceUrlBase = await utils.getHostFqdn()
        }

        // Set some helper attributes for streaming
        this.data.stream.stillImageURL = `https://${stillImageUrlBase}:8123{{ states.camera.${this.device.name.toLowerCase().replace(" ","_")}_snapshot.attributes.entity_picture }}`,
        this.data.stream.streamSource = (this.config.livestream_user && this.config.livestream_pass)
            ? `rtsp://${this.config.livestream_user}:${this.config.livestream_pass}@${streamSourceUrlBase}:8554/${this.deviceId}_live`
            : `rtsp://${streamSourceUrlBase}:8554/${this.deviceId}_live`
    }

    // Publish camera capabilities and state and subscribe to events
    async publishData(data) {
        const isPublish = data === undefined ? true : false
        this.publishPolledState(isPublish)

        if (isPublish) {
            // Publish stream state
            this.publishStreamState(isPublish)
 
            this.publishDingStates()
            if (this.data.snapshot.motion || this.data.snapshot.interval) {
                this.data.snapshot.currentImage ? this.publishSnapshot() : this.refreshSnapshot('interval')
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
                if (this.device.operatingOnBattery) {
                    this.data.snapshot.update = true
                    // If there's not a current snapshot stream, start one now
                    if (this.data.stream.status === 'inactive' || this.data.stream.status === 'failed') {
                        this.startRtspReadStream('snapshot', this.data.stream.duration)
                    } else {
                        // Received a motion ding while a stream is active, extend the expire 
                        // time for stream. Wouldn't it be cool if Ring cameras could actually do this?
                        this.data.stream.snapshot.expires = Math.floor(Date.now()/1000) + this.data.stream.duration
                    }
                }
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
            this.data.motion.detection_enabled = this.device.data.settings.motion_detection_enabled
            attributes.motionDetectionEnabled = this.data.motion.detection_enabled
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
            if (lightState !== this.data.light.state || isPublish) {
                this.data.light.state = lightState
                this.publishMqtt(this.entity.light.state_topic, this.data.light.state, true)
            }
        }
        if (this.device.hasSiren) {
            const sirenState = this.device.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenState !== this.data.siren.state || isPublish) {
                this.data.siren.state = sirenState
                this.publishMqtt(this.entity.siren.state_topic, this.data.siren.state, true)
            }
        }

        if (this.device.data.settings.motion_detection_enabled !== this.data.motion.detection_enabled || isPublish) {
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

    publishStreamState(isPublish) {
        const streamState = (this.data.stream.status === 'active' || this.data.stream.status === 'activating') ? 'ON' : 'OFF'
        if (streamState !== this.data.stream.state || isPublish) {
            this.data.stream.state = streamState
            this.publishMqtt(this.entity.stream.state_topic, this.data.stream.state, true)
        }

        if (this.data.stream_select.state !== this.data.stream_select.publishedState || isPublish) {
            this.data.stream_select.publishedState = this.data.stream_select.state
            this.publishMqtt(this.entity.stream_select.state_topic, this.data.stream_select.state, true)
        }

        const attributes = { status: this.data.stream.status }
        this.publishMqtt(this.entity.stream.json_attributes_topic, JSON.stringify(attributes), true)
    }

    // Publish snapshot image/metadata
    async publishSnapshot() {
        debug(colors.green(`[${this.deviceData.name}]`)+' '+colors.blue(`${this.entity.snapshot.topic}`)+' '+colors.cyan('<binary_image_data>'))
        this.publishMqtt(this.entity.snapshot.topic, this.data.snapshot.currentImage)
        this.publishMqtt(this.entity.snapshot.json_attributes_topic, JSON.stringify({ timestamp: this.data.snapshot.timestamp }))
    }

    // Refresh snapshot on scheduled interval
    async scheduleSnapshotRefresh() {
        this.data.snapshot.intervalTimerId = setInterval(() => {
            if (this.isOnline() && this.data.snapshot.interval && !(this.data.snapshot.motion && this.data.motion.active_ding)) {
                this.refreshSnapshot()
            }
        }, this.data.snapshot.interval * 1000)
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

    // This function uses various methods to get a snapshot to work around limitations
    // of Ring API, ring-client-api snapshot caching, battery cameras, etc.
    async getRefreshedSnapshot() {
        if (this.device.snapshotsAreBlocked) {
            debug('Snapshots are unavailable for camera '+this.deviceId+', check if motion capture is disabled manually or via modes settings')
            return false
        }

        if (this.data.snapshot.motion && this.data.motion.active_ding) {
            if (this.device.operatingOnBattery && this.data.stream.snapshot.active) {
                // Battery powered cameras can't take snapshots while recording, try to get image from video stream instead
                debug('Motion event detected on battery powered camera '+this.deviceId+' snapshot will be updated from live stream')
                this.data.snapshot.update = true
                return 'SnapFromStream'
            } else {
                // Line powered cameras can take a snapshot while recording, but ring-client-api will return a cached
                // snapshot if a previous snapshot was taken within 10 seconds. If a motion event occurs during this time
                // a stale image would be returned so, instead, we call our local function to force an uncached snapshot.
                debug('Motion event detected for line powered camera '+this.deviceId+', forcing a non-cached snapshot update')
                await this.device.requestSnapshotUpdate()
                await utils.sleep(1)
                const newSnapshot = await this.device.restClient.request({
                    url: clientApi(`snapshots/image/${this.device.id}`),
                    responseType: 'buffer'
                })
                return newSnapshot
            }
        } else {
            // If not an active ding it's a scheduled refresh, just call device getSnapshot()
            return await this.device.getSnapshot()
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
            if (this.data.snapshot.update) {
                this.data.snapshot.currentImage = jpegFrame
                this.data.snapshot.timestamp = Math.round(Date.now()/1000)
                this.publishSnapshot()
                this.data.snapshot.update = false
            }
        })

        // Return TCP port for SIP stream to send stream
        return p2jPort
    }

    async startRtspReadStream(type, duration) {
        if (this.data.stream[type].active) { return }
        this.data.stream[type].active = true
        let ffmpegProcess
        
        // Start stream with MJPEG output directed to P2J server with one frame every 2 seconds 
        debug(`Starting a ${type} stream for camera `+this.deviceId)

        if (type === 'snapshot') {
            // Start a P2J pipeline and server and get the listening TCP port
            const p2jPort = await this.startP2J()
            // Create a low frame-rate MJPEG stream to publish motion snapshots
            // Process only key frames to keep CPU usage low
            ffmpegProcess = spawn(pathToFfmpeg, [
                '-skip_frame', 'nokey',
                '-i', this.data.stream.rtspPublishUrl,
                '-f', 'image2pipe',
                '-s', '640:360',
                '-vsync', '0',
                '-q:v', '2',
                `tcp://localhost:+${p2jPort}`
            ])
        } else {
            // Keepalive stream is used only when the live stream is started 
            // manually. It copies only the audio stream to null output just to
            // trigger rtsp-simple-server to start the on-demand stream and 
            // keep it running when there are no other RTSP readers.
            ffmpegProcess = spawn(pathToFfmpeg, [
                '-i', this.data.stream.rtspPublishUrl,
                '-map', '0:a:0',
                '-c:a', 'copy',
                '-f', 'null',
                '-'
            ])
        }

        ffmpegProcess.on('spawn', async () => {
            debug(`The ${type} stream for camera ${this.deviceId} has started`)
        })

        ffmpegProcess.on('close', async () => {
            this.data.stream[type].active = false
            debug(`The ${type} stream for camera ${this.deviceId} has stopped`)
        })

        // If stream starts, set expire time, may be extended by new events
        // (if only Ring sent events while streaming)
        this.data.stream[type].expires = Math.floor(Date.now()/1000) + duration

        // Don't stop stream session until current time > expire time
        // Expire time could be extended by additional motion events, except 
        // Ring devices don't send motion events while a stream is active so
        // it won't ever happen!
        while (Math.floor(Date.now()/1000) < this.data.stream[type].expires) {
            if (type === 'snapshot') {
                const sleeptime = (this.data.stream[type].expires - Math.floor(Date.now()/1000)) + 1
                await utils.sleep(sleeptime)
            } else {
                await utils.sleep(5)
                const pathDetails = await rss.getPathDetails(`${this.deviceId}_live`)
                if (!pathDetails.sourceReady) {
                    // If the source stream stops (due to manual cancel or Ring timeout)
                    // force the keepalive stream to expire
                    this.data.stream[type].expires = 0
                }
            }
        }

        ffmpegProcess.kill()
        this.data.stream[type].active = false
    }

    async setStreamState(message) {
        const command = message.toLowerCase()
        debug(`Received set stream state ${message} for camera ${this.deviceId}`)
        debug(`Location Id: ${this.locationId}`) 
        switch (command) {
            case 'on':
                // Stream was manually started, create a dummy, audio only
                // RTSP source stream to trigger stream startup and keep it active
                this.startRtspReadStream('keepalive', 86400)
                break;
            case 'on-demand':
                if (this.data.stream.status === 'active' || this.data.stream.status === 'activating') {
                    this.publishStreamState()
                    return
                } else {
                    this.data.stream.status = 'activating'
                    this.publishStreamState()
                }
                if (this.data.stream_select.state === 'Live') {
                    this.startLiveStream()
                } else {
                    this.startRecordedStream()
                }
                break;
            case 'off':
                if (this.data.stream.liveSession) {
                    this.data.stream.liveSession.stop()
                } else if (this.data.stream.recordedSession) {
                    this.data.stream.recordedSession.kill()
                } else {
                    this.data.stream.status = 'inactive'
                    this.publishStreamState()
                }
                break;
            default:
                debug('Received unknown command for stream on camera '+this.deviceId)
        }
    }

    async startLiveStream() {
        // Start and publish stream to rtsp-simple-server 
        debug('Establishing connection to live stream for camera '+this.deviceId)
        try {
            this.data.stream.liveSession = await this.device.streamVideo({
                audio: [], video: [],
                // The below takes the native AVC video stream from Rings servers and just 
                // copies the video stream to the RTPS server unmodified.  However, for
                // audio it splits the G.711 μ-law stream into two output streams one
                // being converted to AAC audio, and the other just the raw G.711 stream.
                // This allows support for playback methods that either don't support AAC
                // (e.g. native browser based WebRTC) and provides stong compatibility across
                // the various playback technolgies with minimal processing overhead. 
                output: [
                    '-map', '0:v:0',
                    '-map', '0:a:0',
                    '-map', '0:a:0',
                    '-c:v', 'copy',
                    '-c:a:0', 'aac',
                    '-c:a:1', 'copy',
                    '-f', 'rtsp',
                    '-rtsp_transport', 'tcp',
                    this.data.stream.rtspPublishUrl
                ]
            })

            this.data.stream.status = 'active'
            this.publishStreamState()

            this.data.stream.liveSession.onCallEnded.subscribe(() => {
                debug('Live video stream ended for camera '+this.deviceId)
                this.data.stream.status = 'inactive'
                this.data.stream.liveSession = false
                this.publishStreamState()
            })
        } catch(e) {
            debug(e)
            this.data.stream.status = 'failed'
            this.data.stream.liveSession = false
            this.publishStreamState()
        }
    }

    async startRecordedStream() {
        let recordingUrl
        const streamSelect = this.data.stream_select.state.split(' ')
        const kind = streamSelect[0].toLowerCase().replace('-', '_')
        const index = streamSelect[1]

        debug(`Streaming the ${(index==1?"":index==2?"2nd ":index==3?"3rd ":index+"th ")}most recent ${kind} recording`)
        try {
            const events = ((await this.device.getEvents({ limit: 10, kind })).events).filter(event => event.recording_status === 'ready')
            recordingUrl = await this.device.getRecordingUrl(events[index-1].ding_id_str)
        } catch {
            debug('Failed to retrieve URL for event recording')
            return
        }

        this.data.stream.recordedSession = spawn(pathToFfmpeg, [
            '-re',
            '-i', recordingUrl,
            '-map', '0:v:0',
            '-map', '0:a:0',
            '-map', '0:a:0',
            '-c:v', 'copy',
            '-c:a:0', 'aac',
            '-c:a:1', 'copy',
            '-f', 'rtsp',
            '-rtsp_transport', 'tcp',
            this.data.stream.rtspPublishUrl
        ])

        this.data.stream.recordedSession.on('spawn', async () => {
            debug(`The recorded ${kind} stream for camera ${this.deviceId} has started`)
            this.data.stream.status = 'active'
            this.publishStreamState()
        })

        this.data.stream.recordedSession.on('close', async () => {
            debug(`The recorded ${kind} stream for camera ${this.deviceId} has ended`)
            this.data.stream.recordedSession = false
            this.data.stream.active = 'inactive'
            this.publishStreamState()
        })
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
            case 'stream_select/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setStreamSelect(message)
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
        } else if (!(message >= 10 && message <= 604800)) {
            debug('Snapshot interval value received but out of range (10-604800)')
        } else {
            this.data.snapshot.interval = Math.round(message)
            this.data.snapshot.autoInterval = false
            clearTimeout(this.data.snapshot.intervalTimerId)
            this.scheduleSnapshotRefresh()
            this.publishSnapshotInterval()
            debug ('Snapshot refresh interval has been set to '+this.data.snapshot.interval+' seconds')
        }
    }

    // Set Stream Select Option
    async setStreamSelect(message) {
        debug('Received set video stream to '+message+' for camera '+this.deviceId)
        debug('Location Id: '+ this.locationId)
        if (this.entity.stream_select.options.includes(message)) {
            this.data.stream_select.state = message
            if (this.data.stream_select.state !== this.data.stream_select.publishedState) {
                this.publishStreamState()
                if (this.data.stream.liveSession || this.data.stream.recordedSession) {
                    if (this.data.stream.liveSession) {
                        this.data.stream.liveSession.stop()
                    } else if (this.data.stream.recordedSession) {
                        this.data.stream.recordedSession.kill()
                    }
                    await utils.msleep(250)
                    if (this.data.stream_select.state === 'Live') {
                        this.startLiveStream()
                    } else {
                        this.startRecordedStream()
                    }
                }
            }
        } else {
            debug('Set stream to '+message+' received by not a valid value')
        }
    }
}

module.exports = Camera
