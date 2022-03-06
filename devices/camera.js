const RingPolledDevice = require('./base-polled-device')
const utils = require( '../lib/utils' )
const colors = require('colors/safe')
const P2J = require('pipe2jpeg')
const net = require('net');
const getPort = require('get-port')
const pathToFfmpeg = require('ffmpeg-for-homebridge')
const { spawn } = require('child_process')
const rss = require('../lib/rtsp-simple-server')

class Camera extends RingPolledDevice {
    constructor(deviceInfo) {
        super(deviceInfo, 'camera')

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
                live: {
                    state: 'OFF',
                    status: 'inactive',
                    publishedStatus: '',
                    session: false,
                    rtspPublishUrl: (utils.config.livestream_user && utils.config.livestream_pass)
                        ? `rtsp://${utils.config.livestream_user}:${utils.config.livestream_pass}@localhost:8554/${this.deviceId}_live`
                        : `rtsp://localhost:8554/${this.deviceId}_live`
                },
                event: {
                    state: 'OFF',
                    status: 'inactive',
                    publishedStatus: '',
                    session: false,
                    dingId: null,
                    recordingUrl: null,
                    recordingUrlExpire: null,
                    pollCycle: 0,
                    rtspPublishUrl: (utils.config.livestream_user && utils.config.livestream_pass)
                        ? `rtsp://${utils.config.livestream_user}:${utils.config.livestream_pass}@localhost:8554/${this.deviceId}_event`
                        : `rtsp://localhost:8554/${this.deviceId}_event`
                },
                snapshot: {
                    duration: (this.device.data.settings.video_settings.hasOwnProperty('clip_length_max') && this.device.data.settings.video_settings.clip_length_max) 
                        ? this.device.data.settings.video_settings.clip_length_max
                        : 60,
                    active: false,
                    expires: 0
                },
                keepalive:{ 
                    active: false, 
                    expires: 0
                }
            },
            event_select: {
                state: 'Motion 1',
                publishedState: null
            },
            ...this.device.hasLight ? {
                light: {
                    state: null,
                    setTime: Math.floor(Date.now()/1000)
                }
            } : {},
            ...this.device.hasSiren ? {
                siren: {
                    state: null
                }
            } : {}
        }

        if (utils.config.snapshot_mode.match(/^(motion|interval|all)$/)) {
            this.data.snapshot.motion = (utils.config.snapshot_mode.match(/^(motion|all)$/)) ? true : false

            if (utils.config.snapshot_mode.match(/^(interval|all)$/)) {
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
                attributes: true
            },
            stream: {
                component: 'switch',
                attributes: true,
                name: `${this.deviceData.name} Live Stream`,
                icon: 'mdi:cctv'
            },
            event_stream: {
                component: 'switch',
                attributes: true,
                icon: 'mdi:vhs'
            },
            event_select: {
                component: 'select',
                options: [
                    ...(this.device.isDoorbot
                        ? [ 'Ding 1', 'Ding 2', 'Ding 3', 'Ding 4', 'Ding 5' ]
                        : []),
                    'Motion 1', 'Motion 2', 'Motion 3', 'Motion 4', 'Motion 5',
                    'On-demand 1', 'On-demand 2', 'On-demand 3', 'On-demand 4', 'On-demand 5'
                ],
                attributes: true
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
                value_template: '{{ value_json["lastUpdate"] | default("") }}'
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
                value_template: '{{ value_json["wirelessSignal"] | default("") }}'
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
                value_template: '{{ value_json["batteryLevel"] | default("") }}'
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
        this.data.stream.live.stillImageURL = `https://${stillImageUrlBase}:8123{{ states.camera.${this.device.name.toLowerCase().replace(" ","_")}_snapshot.attributes.entity_picture }}`,
        this.data.stream.live.streamSource = (utils.config.livestream_user && utils.config.livestream_pass)
            ? `rtsp://${utils.config.livestream_user}:${utils.config.livestream_pass}@${streamSourceUrlBase}:8554/${this.deviceId}_live`
            : `rtsp://${streamSourceUrlBase}:8554/${this.deviceId}_live`
    }

    // Publish camera capabilities and state and subscribe to events
    async publishData(data) {
        const isPublish = data === undefined ? true : false
        this.publishPolledState(isPublish)

        // Update every 3 polling cycles (~1 minute), check for updated event or expired recording URL
        this.data.stream.event.pollCycle--
        if (this.data.stream.event.pollCycle <= 0) {
            this.data.stream.event.pollCycle = 3
            if (await this.updateEventStreamUrl() && !isPublish) {
                this.publishStreamSelectState()
            }
        }        

        if (isPublish) {
            // Publish stream state
            this.publishStreamState(isPublish)
            this.publishStreamSelectState(isPublish)
 
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
            this.debug('Camera lost subscription to ding events, attempting to resubscribe...')
            this.device.subscribeToDingEvents().catch(e => { 
                this.debug('Failed to resubscribe camera to ding events. Will retry in 60 seconds.') 
                this.debug(e)
            })
        }
        if (!this.device.data.subscribed_motions === true) {
            this.debug('Camera lost subscription to motion events, attempting to resubscribe...')
            this.device.subscribeToMotionEvents().catch(e => {
                this.debug('Failed to resubscribe camera  to motion events.  Will retry in 60 seconds.')
                this.debug(e)
            })
        }
    }
    
    // Process a ding event
    async processDing(ding) {
        // Is it a motion or doorbell ding? (for others we do nothing)
        if (ding.kind !== 'ding' && ding.kind !== 'motion') { return }
        this.debug(`Camera received ${ding.kind === 'ding' ? 'doorbell' : 'motion'} ding at ${Math.floor(ding.now)}, expires in ${ding.expires_in} seconds`)

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
                this.refreshSnapshot('motion')
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
            this.debug(`All ${ding.kind === 'ding' ? 'doorbell' : 'motion'} dings for camera have expired`)
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
        this.mqttPublish(this.entity[dingKind].state_topic, dingState)

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
        this.mqttPublish(this.entity.motion.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    publishDingAttributes() {
        const attributes = {
            lastDing: this.data.ding.last_ding,
            lastDingTime: this.data.ding.last_ding_time
        }
        this.mqttPublish(this.entity.ding.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    publishPolledState(isPublish) {
        if (this.device.hasLight) {
            const lightState = this.device.data.led_status === 'on' ? 'ON' : 'OFF'
            if ((lightState !== this.data.light.state && Date.now()/1000 - this.data.light.setTime > 30) || isPublish) {
                this.data.light.state = lightState
                this.mqttPublish(this.entity.light.state_topic, this.data.light.state)
            }
        }
        if (this.device.hasSiren) {
            const sirenState = this.device.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenState !== this.data.siren.state || isPublish) {
                this.data.siren.state = sirenState
                this.mqttPublish(this.entity.siren.state_topic, this.data.siren.state)
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
            attributes.stream_Source = this.data.stream.live.streamSource
            attributes.still_Image_URL = this.data.stream.live.stillImageURL
            this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
            this.publishAttributeEntities(attributes)
        }
    }

    publishSnapshotInterval(isPublish) {
        if (isPublish) {
            this.mqttPublish(this.entity.snapshot_interval.state_topic, this.data.snapshot.interval.toString())
        } else {
            // Update snapshot frequency in case it's changed
            if (this.data.snapshot.autoInterval && this.data.snapshot.interval !== this.device.data.settings.lite_24x7.frequency_secs) {
                this.data.snapshot.interval = this.device.data.settings.lite_24x7.frequency_secs
                clearTimeout(this.data.snapshot.intervalTimerId)
                this.scheduleSnapshotRefresh()
            }
            this.mqttPublish(this.entity.snapshot_interval.state_topic, this.data.snapshot.interval.toString())
        }
    }

    publishStreamState(isPublish) {
        ['live', 'event'].forEach(type => {
            const entityProp = (type === 'live') ? 'stream' : `${type}_stream`
            const streamState = (this.data.stream[type].status === 'active' || this.data.stream[type].status === 'activating') ? 'ON' : 'OFF'
            if (streamState !== this.data.stream[type].state || isPublish) {
                this.data.stream[type].state = streamState
                this.mqttPublish(this.entity[entityProp].state_topic, this.data.stream[type].state)
            }

            if (this.data.stream[type].publishedStatus !== this.data.stream[type].status || isPublish) {
                this.data.stream[type].publishedStatus = this.data.stream[type].status
                const attributes = { status: this.data.stream[type].status }
                this.mqttPublish(this.entity[entityProp].json_attributes_topic, JSON.stringify(attributes), 'attr')
            } 
        })
    }

    publishStreamSelectState(isPublish) {
        if (this.data.event_select.state !== this.data.event_select.publishedState || isPublish) {
            this.data.event_select.publishedState = this.data.event_select.state
            this.mqttPublish(this.entity.event_select.state_topic, this.data.event_select.state)
        }
        const attributes = { 
            recordingUrl: this.data.stream.event.recordingUrl,
            eventId: this.data.stream.event.dingId
        }
        this.mqttPublish(this.entity.event_select.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    // Publish snapshot image/metadata
    publishSnapshot() {
        this.debug(colors.blue(`${this.entity.snapshot.topic}`)+' '+colors.cyan('<binary_image_data>'))
        this.mqttPublish(this.entity.snapshot.topic, this.data.snapshot.currentImage, false)
        this.mqttPublish(this.entity.snapshot.json_attributes_topic, JSON.stringify({ timestamp: this.data.snapshot.timestamp }), 'attr')
    }

    // Refresh snapshot on scheduled interval
    scheduleSnapshotRefresh() {
        this.data.snapshot.intervalTimerId = setInterval(() => {
            if (this.isOnline() && this.data.snapshot.interval && !(this.data.snapshot.motion && this.data.motion.active_ding)) {
                this.refreshSnapshot('interval')
            }
        }, this.data.snapshot.interval * 1000)
    }

    refreshSnapshot(type) {
        if (!this.device.operatingOnBattery || (type === 'interval' && this.data.stream.live.status.match(/^(inactive|failed)$/))) {
            // For line powered cameras, or battery cameras with no active stream,
            // assume a regular snapshot update request will work
            this.updateSnapshot(type)
        } else {
            this.data.snapshot.update = true

            // Battery powered cameras can take a snapshot while recording so, if it's a motion
            // event or there's an active local stream, grab a key frame to use for the snapshot
            if (type === 'motion') {
                this.debug('Motion event detected on battery powered camera, snapshot will be updated from live stream')
            }

            // If there's no existing active local stream, start one as it's required to get a snapshot 
            if (!this.data.stream.snapshot.active) {
                this.startRtspReadStream('snapshot', this.data.stream.snapshot.duration)
            }
        }
    }

    async updateSnapshot(type) {
        let newSnapshot = false

        if (this.device.snapshotsAreBlocked) {
            this.debug('Snapshots are unavailable, check if motion capture is disabled manually or via modes settings')
            return
        }

        try {
            if (type === 'motion') {
                this.debug('Requesting an updated motion snapshot')
                newSnapshot = await this.device.getNextSnapshot({ force: true })
            } else {
                this.debug('Requesting an updated interval snapshot')
                newSnapshot = await this.device.getSnapshot()
            }
        } catch (error) {
            this.debug(error) 
            this.debug('Failed to retrieve updated snapshot')
        }

        if (newSnapshot) {
            this.debug('Succesfully retrieved updated snapshot')
            this.data.snapshot.currentImage = newSnapshot
            this.data.snapshot.timestamp = Math.round(Date.now()/1000)
            this.publishSnapshot()
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
        let killSignal = 'SIGTERM'
        
        // Start stream with MJPEG output directed to P2J server with one frame every 2 seconds 
        this.debug(`Starting a ${type} stream for camera`)

        if (type === 'snapshot') {
            // Start a P2J pipeline and server and get the listening TCP port
            const p2jPort = await this.startP2J()
            // Create a low frame-rate MJPEG stream to publish motion snapshots
            // Process only key frames to keep CPU usage low
            ffmpegProcess = spawn(pathToFfmpeg, [
                '-skip_frame', 'nokey',
                '-i', this.data.stream.live.rtspPublishUrl,
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
                '-i', this.data.stream.live.rtspPublishUrl,
                '-map', '0:a:0',
                '-c:a', 'copy',
                '-f', 'null',
                '/dev/null'
            ])
        }

        ffmpegProcess.on('spawn', async () => {
            this.debug(`The ${type} stream has started`)
        })

        ffmpegProcess.on('close', async () => {
            this.data.stream[type].active = false
            this.debug(`The ${type} stream has stopped`)
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
                    this.debug('Ring live stream has stopped publishing, killing the keepalive stream')
                    this.data.stream[type].expires = 0
                     // For some reason the keepalive stream never times out so kill the process hard
                    killSignal = 'SIGKILL'
                }
            }
        }

        ffmpegProcess.kill(killSignal)
        this.data.stream[type].active = false
    }

    async startLiveStream() {
        // Start and publish stream to rtsp-simple-server 
        this.debug('Establishing connection to live stream')
        try {
            this.data.stream.live.session = await this.device.streamVideo({
                // The below takes the native AVC video stream from Rings servers and just 
                // copies the video stream to the RTSP server unmodified.  However, for
                // audio it splits the G.711 μ-law stream into two output streams one
                // being converted to AAC audio, and the other just the raw G.711 stream.
                // This allows support for playback methods that either don't support AAC
                // (e.g. native browser based WebRTC) and provides stong compatibility across
                // the various playback technolgies with minimal processing overhead. 
                video: [],
                output: [
                    '-map', '0:v:0',
                    '-map', '0:a:0',
                    '-map', '0:a:0',
                    '-c:v', 'copy',
                    '-c:a:0', 'aac',
                    '-c:a:1', 'copy',
                    '-f', 'rtsp',
                    '-rtsp_transport', 'tcp',
                    this.data.stream.live.rtspPublishUrl
                ]
            })

            this.data.stream.live.status = 'active'
            this.publishStreamState()

            this.data.stream.live.session.onCallEnded.subscribe(() => {
                this.debug('Live video stream ended')
                this.data.stream.live.status = 'inactive'
                this.data.stream.live.session = false
                this.publishStreamState()
            })
        } catch(e) {
            this.debug(e)
            this.data.stream.live.status = 'failed'
            this.data.stream.live.session = false
            this.publishStreamState()
        }
    }

    async startEventStream() {
        if (await this.updateEventStreamUrl()) {
            this.publishStreamSelectState()
        }
        const streamSelect = this.data.event_select.state.split(' ')
        const kind = streamSelect[0].toLowerCase().replace('-', '_')
        const index = streamSelect[1]
        this.debug(`Streaming the ${(index==1?"":index==2?"2nd ":index==3?"3rd ":index+"th ")}most recently recorded ${kind} event`)

        try {
            this.data.stream.event.session = spawn(pathToFfmpeg, [
                '-re',
                '-i', this.data.stream.event.recordingUrl,
                '-map', '0:v:0',
                '-map', '0:a:0',
                '-map', '0:a:0',
                '-c:v', 'copy',
                '-c:a:0', 'aac',
                '-c:a:1', 'copy',
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                this.data.stream.event.rtspPublishUrl
            ])

            this.data.stream.event.session.on('spawn', async () => {
                this.debug(`The recorded ${kind} event stream has started`)
                this.data.stream.event.status = 'active'
                this.publishStreamState()
            })

            this.data.stream.event.session.on('close', async () => {
                this.debug(`The recorded ${kind} event stream has ended`)
                this.data.stream.event.status = 'inactive'
                this.data.stream.event.session = false
                this.publishStreamState()
            })
        } catch(e) {
            this.debug(e)
            this.data.stream.event.status = 'failed'
            this.data.stream.event.session = false
            this.publishStreamState()
        }
    }

    async updateEventStreamUrl() {
        const streamSelect = this.data.event_select.state.split(' ')
        const kind = streamSelect[0].toLowerCase().replace('-', '_')
        const index = streamSelect[1]-1
        let recordingUrl
        let dingId

        try {
            const events = ((await this.device.getEvents({ limit: 10, kind })).events).filter(event => event.recording_status === 'ready')
            dingId = events[index].ding_id_str
            if (dingId !== this.data.stream.event.dingId) {
                this.debug(`New ${kind} event detected, updating the event recording URL`)
                recordingUrl = await this.device.getRecordingUrl(dingId)
            } else if (Math.floor(Date.now()/1000) - this.data.stream.event.recordingUrlExpire > 0) {
                this.debug(`Previous ${kind} event recording URL has expired, updating the event recording URL`)
                recordingUrl = await this.device.getRecordingUrl(dingId)
            }
        } catch {
            this.debug(`Failed to retrieve ${kind} event recording URL for event`)
            return false
        }

        if (recordingUrl) {
                this.data.stream.event.dingId = dingId
                this.data.stream.event.recordingUrl = recordingUrl
                this.data.stream.event.recordingUrlExpire = Math.floor(Date.now()/1000) + 600
            return true
        } else {
            return false
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
                    this.setStreamState('live', message)
                }
                break;
            case 'event_stream/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setStreamState('event', message)
                }
                break;
            case 'event_select/command':
                if (this.entity.hasOwnProperty(entityKey)) {
                    this.setEventSelect(message)
                }
                break;
            default:
                this.debug(`Received message to unknown command topic: ${componentCommand}`)
        }
    }

    // Set switch target state on received MQTT command message
    async setLightState(message) {
        this.debug(`Received set light state ${message}`)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
            case 'off':
                this.data.light.setTime = Math.floor(Date.now()/1000)
                await this.device.setLight(command === 'on' ? true : false)
                this.data.light.state = command === 'on' ? 'ON' : 'OFF'
                this.mqttPublish(this.entity.light.state_topic, this.data.light.state)
                break;
            default:
                this.debug('Received unknown command for light')
        }
    }

    // Set switch target state on received MQTT command message
    async setSirenState(message) {
        this.debug(`Received set siren state ${message}`)
        const command = message.toLowerCase()

        switch (command) {
            case 'on':
            case 'off':
                await this.device.setSiren(command === 'on' ? true : false)
                break;
            default:
                this.debug('Received unknown command for siren')
        }
    }

    // Set refresh interval for snapshots
    setSnapshotInterval(message) {
        this.debug(`Received set snapshot refresh interval ${message}`)
        if (isNaN(message)) {
            this.debug('Snapshot interval value received but not a number')
        } else if (!(message >= 10 && message <= 604800)) {
            this.debug('Snapshot interval value received but out of range (10-604800)')
        } else {
            this.data.snapshot.interval = Math.round(message)
            this.data.snapshot.autoInterval = false
            clearTimeout(this.data.snapshot.intervalTimerId)
            this.scheduleSnapshotRefresh()
            this.publishSnapshotInterval()
            this.debug('Snapshot refresh interval has been set to '+this.data.snapshot.interval+' seconds')
        }
    }

    setStreamState(type, message) {
        const command = message.toLowerCase()
        this.debug(`Received set ${type} stream state ${message}`)
        switch (command) {
            case 'on':
                if (type === 'live') {
                    // Stream was manually started, create a dummy, audio only
                    // RTSP source stream to trigger stream startup and keep it active
                    this.startRtspReadStream('keepalive', 86400)
                } else {
                    this.debug(`Event stream can only be started on-demand!`)
                    return
                }
                break;
            case 'on-demand':
                if (this.data.stream[type].status === 'active' || this.data.stream[type].status === 'activating') {
                    this.publishStreamState()
                    return
                } else {
                    this.data.stream[type].status = 'activating'
                    this.publishStreamState()
                    if (type === 'live') {
                        this.startLiveStream()
                    } else {
                        this.startEventStream()
                    }
                }
                break;
            case 'off':
                if (type === 'live' && this.data.stream[type].session) {
                    this.data.stream[type].session.stop()
                } else if (type === 'event' && this.data.stream[type].session) {
                    this.data.stream[type].session.kill()
                } else {
                    this.data.stream[type].status = 'inactive'
                    this.publishStreamState()
                }
                break;
            default:
                this.debug(`Received unknown command for ${type} stream`)
        }
    }

    // Set Stream Select Option
    async setEventSelect(message) {
        this.debug(`Received set event stream to ${message}`)
        if (this.entity.event_select.options.includes(message)) {
            if (this.data.stream.event.session) {
                this.data.stream.event.session.kill()
            }
            this.data.event_select.state = message
            if (await this.updateEventStreamUrl()) {
                this.publishStreamSelectState()
            }
        } else {
            this.debug(`Set event stream to ${message} received by not a valid value`)
        }
    }
}

module.exports = Camera