import RingPolledDevice from './base-polled-device.js'
import utils from '../lib/utils.js'
import streamer from '../lib/streamer.js'
import { parseISO, addSeconds } from 'date-fns';

export default class Camera extends RingPolledDevice {
    constructor(deviceInfo, events) {
        super(deviceInfo, 'camera')

        const savedState = this.getSavedState()

        this.hasBattery1 = Boolean(this.device.data.hasOwnProperty('battery_voltage'))
        this.hasBattery2 = Boolean(this.device.data.hasOwnProperty('battery_voltage_2'))

        this.hevcEnabled = this.device.data?.settings?.video_settings?.hevc_enabled
            ? this.device.data.settings.video_settings.hevc_enabled
            : false

        this.data = {
            motion: {
                active_ding: false,
                duration: savedState?.motion?.duration ? savedState.motion.duration : 180,
                publishedDuration: false,
                last_ding: 0,
                last_ding_expires: 0,
                last_ding_time: 'none',
                is_person: false,
                detection_enabled: null,
                warning_enabled: null,
                events: events.filter(event => event.event_type === 'motion'),
                latestEventId: ''
            },
            ...this.device.isDoorbot ? {
                ding: {
                    active_ding: false,
                    duration: savedState?.ding?.duration ? savedState.ding.duration : 180,
                    publishedDurations: false,
                    last_ding: 0,
                    last_ding_expires: 0,
                    last_ding_time: 'none',
                    events: events.filter(event => event.event_type === 'ding'),
                    latestEventId: ''
                }
            } : {},
            snapshot: {
                mode: savedState?.snapshot?.mode
                    ?  savedState.snapshot.mode.replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())
                    : 'Auto',
                ding: false,
                motion: false,
                interval: false,
                autoInterval: savedState?.snapshot?.autoInterval
                    ? savedState.snapshot.autoInterval
                    : true,
                intervalDuration: savedState?.snapshot?.intervalDuration
                    ? savedState.snapshot.intervalDuration
                    : (this.device.operatingOnBattery) ? 600 : 30,
                intervalTimerId: null,
                cache: null,
                cacheType: null,
                timestamp: null,
                onDemandTimestamp: 0
            },
            stream: {
                live: {
                    state: 'OFF',
                    status: 'inactive',
                    session: false,
                    publishedStatus: ''
                },
                event: {
                    state: 'OFF',
                    status: 'inactive',
                    session: false,
                    publishedStatus: ''
                }
            },
            video_mode: {
                // A camera that has been seen before keeps the historical
                // behaviour of always requesting H.264, while one appearing for
                // the first time follows the camera's own HEVC setting.
                mode: savedState?.video_mode?.mode
                    ? savedState.video_mode.mode
                    : savedState?.video_codec?.mode
                        // Migrated from the short lived video_codec setting, whose
                        // explicit H.265 choice is closest to Optimal.
                        ? (savedState.video_codec.mode === 'Compatible' ? 'Compatible' : 'Optimal')
                        : (savedState ? 'Compatible' : 'Optimal'),
                publishedMode: null
            },
            event_select: {
                state: savedState?.event_select?.state
                    ? savedState.event_select.state
                    : 'Motion 1',
                publishedState: null,
                pollCycle: 0,
                recordingUrl: null,
                recordingUrlExpire: null,
                transcoded: false,
                eventId: '0'
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
            } : {},
            subscriptions: {
                ding: { failures: 0, skipCycles: 0, reportedNotPermitted: false },
                motion: { failures: 0, skipCycles: 0, reportedNotPermitted: false }
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
                category: 'diagnostic',
                attributes: true,
                name: 'Live Stream',
                icon: 'mdi:cctv',
                // Use internal MQTT server for inter-process communications
                ipc: true
            },
            event_stream: {
                component: 'switch',
                category: 'diagnostic',
                attributes: true,
                icon: 'mdi:vhs',
                // Use internal MQTT server for inter-process communications
                ipc: true
            },
            event_select: {
                component: 'select',
                category: 'config',
                options: [
                    ...this.device.isDoorbot
                        ? [ 'Ding 1', 'Ding 2', 'Ding 3', 'Ding 4', 'Ding 5',
                            'Ding 1 (Transcoded)', 'Ding 2 (Transcoded)', 'Ding 3 (Transcoded)',
                            'Ding 4 (Transcoded)', 'Ding 5 (Transcoded)'
                        ]
                        : [],
                    'Motion 1', 'Motion 2', 'Motion 3', 'Motion 4', 'Motion 5',
                    'Motion 1 (Transcoded)', 'Motion 2 (Transcoded)', 'Motion 3 (Transcoded)',
                    'Motion 4 (Transcoded)', 'Motion 5 (Transcoded)',
                    'Person 1', 'Person 2', 'Person 3', 'Person 4', 'Person 5',
                    'Person 1 (Transcoded)', 'Person 2 (Transcoded)', 'Person 3 (Transcoded)',
                    'Person 4 (Transcoded)', 'Person 5 (Transcoded)',
                    'On-demand 1', 'On-demand 2', 'On-demand 3', 'On-demand 4', 'On-demand 5',
                    'On-demand 1 (Transcoded)', 'On-demand 2 (Transcoded)', 'On-demand 3 (Transcoded)',
                    'On-demand 4 (Transcoded)', 'On-demand 5 (Transcoded)',
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
            snapshot: {
                component: 'camera',
                attributes: true
            },
            video_mode: {
                component: 'select',
                category: 'config',
                icon: 'mdi:video',
                options: [ 'Compatible', 'Optimal' ]
            },
            snapshot_mode: {
                component: 'select',
                category: 'config',
                options: [
                    ...this.device.isDoorbot
                        ? [
                            'All', 'Auto', 'Ding', 'Interval', 'Interval + Ding',
                            'Interval + Motion', 'Motion', 'Motion + Ding', 'Disabled'
                        ]
                        : [ 'All', 'Auto', 'Interval', 'Motion', 'Disabled' ]
                ]
            },
            snapshot_interval: {
                component: 'number',
                category: 'config',
                min: 10,
                max: 604800,
                mode: 'box',
                icon: 'hass:timer'
            },
            take_snapshot: {
                component: 'button',
                icon: 'mdi:camera'
            },
            motion_detection: {
                component: 'switch',
                category: 'config'
            },
            ...this.device.data.features?.motion_message_enabled ? {
                motion_warning: {
                    component: 'switch',
                    category: 'config'
                }
            } : {},
            motion_duration: {
                component: 'number',
                category: 'config',
                min: 10,
                max: 180,
                mode: 'box',
                icon: 'hass:timer'
            },
            ...this.device.isDoorbot ? {
                ding_duration: {
                    component: 'number',
                    category: 'config',
                    min: 10,
                    max: 180,
                    icon: 'hass:timer'
                }
            } : {},
            info: {
                component: 'sensor',
                category: 'diagnostic',
                device_class: 'timestamp',
                value_template: '{{ value_json["lastUpdate"] | default("") }}'
            }
        }

        this.device.onNewNotification.subscribe(notification => {
            this.processNotification(notification)
        })

        this.updateSnapshotMode()
        this.scheduleSnapshotRefresh()

        this.updateDeviceState()
    }

    updateDeviceState() {
        const stateData = {
            snapshot: {
                mode: this.data.snapshot.mode,
                autoInterval: this.data.snapshot.autoInterval,
                interval: this.data.snapshot.intervalDuration
            },
            event_select: {
                state: this.data.event_select.state
            },
            video_mode: {
                mode: this.data.video_mode.mode
            },
            motion: {
                duration: this.data.motion.duration
            },
            ...this.device.isDoorbot ? {
                ding: {
                    duration: this.data.ding.duration
                }
            } : {}
        }
        this.setSavedState(stateData)
    }

    // Build standard and optional entities for device
    async initAttributeEntities() {
         // If device is wireless publish signal strength entity
        const deviceHealth = await this.getHealth()
        if (deviceHealth && !(deviceHealth?.network_connection && deviceHealth.network_connection === 'ethernet')) {
            this.entity.wireless = {
                component: 'sensor',
                category: 'diagnostic',
                device_class: 'signal_strength',
                unit_of_measurement: 'dBm',
                parent_state_topic: 'info/state',
                attributes: 'wireless',
                value_template: '{{ value_json["wirelessSignal"] | default("") }}'
            }
        }

        // If device is battery powered publish battery entity
        if (this.device.batteryLevel || this.hasBattery1 || this.hasBattery2) {
            this.entity.battery = {
                component: 'sensor',
                category: 'diagnostic',
                device_class: 'battery',
                unit_of_measurement: '%',
                state_class: 'measurement',
                parent_state_topic: 'info/state',
                attributes: 'battery',
                value_template: '{{ value_json["batteryLevel"] | default("") }}'
            }
        }

        // If no motion events in device event cache, request recent motion events
        if (this.data.motion.events.length === 0) {
            const response = await this.getDeviceHistory({limit: 5, event_types: 'motion'})
            if (Array.isArray(response?.items) && response.items.length > 0) {
                this.data.motion.events = response.items
            }
        }

        if (this.data.motion.events.length > 0) {
            const lastMotionEvent = this.data.motion.events[0]
            const lastMotionDate = lastMotionEvent?.start_time ? new Date(lastMotionEvent.start_time) : false
            this.data.motion.last_ding = lastMotionDate ? Math.floor(lastMotionDate/1000) : 0
            this.data.motion.last_ding_time = lastMotionDate ? utils.getISOTime(lastMotionDate) : ''
            this.data.motion.is_person = Boolean(lastMotionEvent?.cv?.person_detected)
            this.data.motion.latestEventId = lastMotionEvent.event_id

            // Try to get URL for most recent motion event, if it fails, assume there's no subscription
            let recordingUrl = false
            const recordingEvent = this.data.motion.events.find(e => e.recording_status === 'ready')
            if (recordingEvent && Array.isArray(recordingEvent.visualizations?.cloud_media_visualization?.media)) {
                recordingUrl = (recordingEvent.visualizations.cloud_media_visualization.media.find(e => e.file_type === 'VIDEO'))?.url
            }

            if (!recordingUrl) {
                this.debug('Could not retrieve recording URL for any motion event, assuming no Ring Protect subscription')
                delete this.entity.event_stream
                delete this.entity.event_select
            }
        } else {
            this.debug('Unable to retrieve most recent motion event for this camera')
        }

        // Get most recent ding event data
        if (this.device.isDoorbot) {
            // If no ding events in device event cache, request recent ding events
            if (this.data.ding.events.length === 0) {
                const response = await this.getDeviceHistory({limit: 5, event_types: 'ding'})
                if (Array.isArray(response?.items) && response.items.length > 0) {
                    this.data.ding.events = response.items
                }
            }

            if (this.data.ding.events.length > 0) {
                const lastDingEvent = this.data.ding.events[0]
                const lastDingDate = lastDingEvent?.start_time ? new Date(lastDingEvent.start_time) : false
                this.data.ding.last_ding = lastDingDate ? Math.floor(lastDingDate/1000) : 0
                this.data.ding.last_ding_time = lastDingDate ? utils.getISOTime(lastDingDate) : ''
                this.data.ding.latestEventId = lastDingEvent.event_id
            } else {
                this.debug('Unable to retrieve most recent ding event for this doorbell')
            }
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
        this.data.stream.live.streamSource = (utils.config().livestream_user && utils.config().livestream_pass)
            ? `rtsp://${utils.config().livestream_user}:${utils.config().livestream_pass}@${streamSourceUrlBase}:8554/${this.deviceId}_live`
            : `rtsp://${streamSourceUrlBase}:8554/${this.deviceId}_live`
    }

    updateSnapshotMode() {
        this.data.snapshot.ding = Boolean(this.device.isDoorbot && this.data.snapshot.mode.match(/(ding|^all|auto$)/i))
        this.data.snapshot.motion = Boolean(this.data.snapshot.mode.match(/(motion|^all|auto$)/i))

        this.data.snapshot.interval = this.data.snapshot.mode === 'Auto'
            ? Boolean(!this.device.operatingOnBattery)
            : Boolean(this.data.snapshot.mode.match(/(interval|^all$)/i))

        if (this.data.snapshot.interval && this.data.snapshot.autoInterval) {
            // If interval snapshots are enabled but interval is not manually set, try to detect a reasonable defaults
            if (this.device.operatingOnBattery) {
                if (this.device.data.settings.lite_24x7?.enabled) {
                    this.data.snapshot.intervalDuration = this.device.data.settings.lite_24x7.frequency_secs
                } else {
                    this.data.snapshot.intervalDuration = 600
                }
            } else {
                // For wired cameras default to 30 seconds
                this.data.snapshot.intervalDuration = 30
            }
        }
    }

    // The video_codec select was replaced by video_mode.  Publishing an empty
    // payload to a discovery topic is how Home Assistant is told an entity no
    // longer exists.  This is sent on every full publish rather than only when
    // the old setting is detected: updateDeviceState rebuilds the saved state
    // from scratch and so has usually already dropped the old key by the time
    // anything could check for it, and repeating it also covers a Home
    // Assistant restart, which triggers a republish.
    cleanupLegacyVideoCodec() {
        this.mqttPublish(`homeassistant/select/${this.locationId}/${this.deviceId}_video_codec/config`, '', false)
    }

    // Publish camera capabilities and state and subscribe to events
    async publishState(data) {
        const isPublish = Boolean(data === undefined)

        if (isPublish) {
            this.cleanupLegacyVideoCodec()
        }
        this.publishPolledState(isPublish)

        // Checks for new events or expired recording URL every 3 polling cycles (~1 minute)
        if (this.entity.hasOwnProperty('event_select')) {
            this.data.event_select.pollCycle--
            if (this.data.event_select.pollCycle <= 0) {
                this.data.event_select.pollCycle = 3
                if (await this.updateEventStreamUrl() && !isPublish) {
                    this.publishEventSelectState()
                }
            }
        }

        if (isPublish) {
            // Publish stream state
            this.publishStreamState(isPublish)
            if (this.entity.event_select) {
                this.publishEventSelectState(isPublish)
            }

            this.publishDingStates()
            this.publishDingDurationState(isPublish)
            this.publishVideoMode()
            this.publishSnapshotMode()
            if (this.data.snapshot.motion || this.data.snapshot.ding || this.data.snapshot.interval) {
                this.data.snapshot.cache ? this.publishSnapshot() : this.refreshSnapshot('interval')
                this.publishSnapshotInterval(isPublish)
            }
            this.publishAttributes()
        }

        // Check for subscription to ding and motion events and attempt to resubscribe
        if (this.device.isDoorbot && !this.device.data.subscribed === true) {
            this.resubscribe('ding')
        }
        if (!this.device.data.subscribed_motions === true) {
            this.resubscribe('motion')
        }
    }

    // Resubscribe to ding/motion events, backing off on repeated failures.  Some
    // cameras shared with this account are not permitted to subscribe at all and
    // return an error on every attempt, so retrying every cycle is just noise.
    async resubscribe(eventType) {
        const subscription = this.data.subscriptions[eventType]

        // Cameras shared without the device_alerts_manage operation are not
        // permitted to subscribe at all, so don't bother asking
        if (this.device.canSubscribeToNotifications === false) {
            if (!subscription.reportedNotPermitted) {
                subscription.reportedNotPermitted = true
                this.debug(`This camera is shared with your account without permission to manage device alerts, so ${eventType} notifications cannot be subscribed to and these events will not be received`)
                this.debug(`Permitted operations for this camera: ${this.device.data.operations?.join(', ')}`)
            }
            return
        }

        if (subscription.skipCycles > 0) {
            subscription.skipCycles--
            return
        }

        this.debug(`Camera lost subscription to ${eventType} events, attempting to resubscribe...`)

        try {
            await (eventType === 'ding'
                ? this.device.subscribeToDingEvents()
                : this.device.subscribeToMotionEvents())
            subscription.failures = 0
        } catch (err) {
            subscription.failures++
            // Skip 1, 2, 4, 8... polling cycles, up to ~1 hour between attempts
            subscription.skipCycles = Math.min(2 ** (subscription.failures - 1), 180)
            const retrySeconds = subscription.skipCycles * 20
            this.debug(err)
            this.debug(`Failed to resubscribe camera to ${eventType} events, will retry in ~${
                retrySeconds < 120 ? `${retrySeconds} seconds` : `${Math.round(retrySeconds/60)} minutes`
            }.`)
        }
    }

    // Process a ding event
    async processNotification(pushData) {
        let dingKind
        // Is it a motion or doorbell ding? (for others we do nothing)
        switch (pushData.android_config?.category) {
            case 'com.ring.pn.live-event.ding':
                dingKind = 'ding'
                break
            case 'com.ring.pn.live-event.motion':
                dingKind = 'motion'
                break
            default:
                this.debug(`Received push notification of unknown category ${pushData.android_config?.category}`)
                return
        }
        this.debug(`Received ${dingKind} push notification, expires in ${this.data[dingKind].duration} seconds`)

        // Is this a new Ding or refresh of active ding?
        const newDing = Boolean(!this.data[dingKind].active_ding)
        this.data[dingKind].active_ding = true

        // Update last_ding and expire time
        // The eventito timestamp is the most accurate source, but fall back to the
        // ding created time, and finally to the current time, so that a push format
        // change can never leave the ding with an invalid expire time, which would
        // cause it to expire immediately
        const eventTimestamp = pushData.data?.event?.eventito?.timestamp
            || Date.parse(pushData.data?.event?.ding?.created_at ?? '')
        this.data[dingKind].last_ding = Math.floor((eventTimestamp || Date.now())/1000)
        this.data[dingKind].last_ding_time = pushData.data?.event?.ding?.created_at
        this.data[dingKind].last_ding_expires = this.data[dingKind].last_ding+this.data[dingKind].duration

        // If motion ding and snapshots on motion are enabled, publish a new snapshot
        if (dingKind === 'motion') {
            this.data[dingKind].is_person = Boolean(pushData.data?.event?.ding?.detection_type === 'human')
            if (this.data.snapshot.motion) {
                this.refreshSnapshot('motion', pushData?.img?.snapshot_uuid)
            }
        } else if (this.data.snapshot.ding) {
            // If doorbell press and snapshots on ding are enabled, publish a new snapshot
            this.refreshSnapshot('ding', pushData?.img?.snapshot_uuid)
        }

        // Publish MQTT active sensor state
        // Will republish to MQTT for new dings even if ding is already active
        this.publishDingState(dingKind)

        // If new ding, begin expiration loop (only needed for first ding as others just extend time)
        if (newDing) {
            // Loop until current time is > last_ding expires time.  Sleeps until
            // estimated expire time, but may loop if new dings increase last_ding_expires
            while (Math.floor(Date.now()/1000) < this.data[dingKind].last_ding_expires) {
                const sleeptime = (this.data[dingKind].last_ding_expires - Math.floor(Date.now()/1000)) + 1
                await utils.sleep(sleeptime)
            }
            // All dings have expired, set ding state back to false/off and publish
            this.debug(`All ${dingKind} dings for camera have expired`)
            this.data[dingKind].active_ding = false
            this.publishDingState(dingKind)
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
        // Push notifications are subscribed at construction, well before discovery runs, so a
        // ding can arrive with no entity topics available.  The ding data itself is still
        // updated and publishState() sends the current state once the device is published.
        if (!this.discoveryPublished) { return }

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

        // Publish motion switch settings and attributes
        if (this.device.data.settings.motion_detection_enabled !== this.data.motion.detection_enabled || isPublish) {
            this.publishMotionAttributes()
            this.mqttPublish(this.entity.motion_detection.state_topic, this.device.data?.settings?.motion_detection_enabled ? 'ON' : 'OFF')
        }

        if (this.entity.hasOwnProperty('motion_warning') && (this.device.data.settings.motion_announcement !== this.data.motion.warning_enabled || isPublish)) {
            this.mqttPublish(this.entity.motion_warning.state_topic, this.device.data.settings.motion_announcement ? 'ON' : 'OFF')
            this.data.motion.warning_enabled = this.device.data.settings.motion_announcement
        }
    }

    // Publish device data to info topic
    async publishAttributes() {
        const attributes = {
            stream_Source: this.data.stream.live.streamSource,
            still_Image_URL: this.data.stream.live.stillImageURL
        }
        const deviceHealth = await this.getHealth()

        if (this.device.batteryLevel || this.hasBattery1 || this.hasBattery2) {
            if (deviceHealth && deviceHealth.hasOwnProperty('active_battery')) {
                attributes.activeBattery = deviceHealth.active_battery
            }

            // Reports the level of the currently active battery, might be null if removed so report 0% in that case
            attributes.batteryLevel = this.device.batteryLevel && utils.isNumeric(this.device.batteryLevel)
                ? this.device.batteryLevel
                : 0

            // Must have at least one battery, but it might not be inserted, so report 0% in that case
            attributes.batteryLife = this.device.data.hasOwnProperty('battery_life') && utils.isNumeric(this.device.data.battery_life)
                ? Number.parseFloat(this.device.data.battery_life)
                : 0

            if (this.hasBattery2) {
                attributes.batteryLife2 = this.device.data.hasOwnProperty('battery_life_2') && utils.isNumeric(this.device.data.battery_life_2)
                    ? Number.parseFloat(this.device.data.battery_life_2)
                    : 0
            }
        }

        if (deviceHealth) {
            attributes.firmwareStatus = deviceHealth.firmware
            attributes.lastUpdate = deviceHealth.updated_at.slice(0,-6)+"Z"
            if (deviceHealth.hasOwnProperty('network_connection') && deviceHealth.network_connection === 'ethernet') {
                attributes.wiredNetwork = this.device.data.alerts.connection
            } else {
                attributes.wirelessNetwork = deviceHealth.wifi_name
                attributes.wirelessSignal = deviceHealth.latest_signal_strength
            }
        }

        if (Object.keys(attributes).length > 0) {
            this.mqttPublish(this.entity.info.state_topic, JSON.stringify(attributes), 'attr')
            this.publishAttributeEntities(attributes)
        }
    }

    publishSnapshotInterval(isPublish) {
        if (isPublish) {
            this.mqttPublish(this.entity.snapshot_interval.state_topic, this.data.snapshot.intervalDuration.toString())
        } else {
            // Update snapshot frequency in case it's changed
            if (this.data.snapshot.autoInterval && this.data.snapshot.intervalDuration !== this.device.data.settings.lite_24x7.frequency_secs) {
                this.data.snapshot.intervalDuration = this.device.data.settings.lite_24x7.frequency_secs
                clearInterval(this.data.snapshot.intervalTimerId)
                this.scheduleSnapshotRefresh()
            }
            this.mqttPublish(this.entity.snapshot_interval.state_topic, this.data.snapshot.intervalDuration.toString())
        }
    }

    publishSnapshotMode() {
        this.mqttPublish(this.entity.snapshot_mode.state_topic, this.data.snapshot.mode)
    }

    publishVideoMode() {
        this.mqttPublish(this.entity.video_mode.state_topic, this.data.video_mode.mode)
        this.data.video_mode.publishedMode = this.data.video_mode.mode
    }

    // Resolves the selected mode to the codec actually offered to Ring.  Only
    // H.264 has ever been offered historically, so "Compatible" reproduces that
    // exactly, while "Optimal" follows whatever the camera itself is set to.
    getStreamVideoCodec() {
        return this.data.video_mode.mode === 'Optimal' && this.hevcEnabled ? 'h265' : 'h264'
    }

    setVideoMode(message) {
        this.debug(`Received set video mode to ${message}`)
        const mode = this.entity.video_mode.options.find(o => o.toLowerCase() === message.toLowerCase())

        if (mode) {
            this.data.video_mode.mode = mode
            this.debug(`Video mode has been set to ${mode}, streams will request ${this.getStreamVideoCodec().toUpperCase()}`)
            this.debug('Any active stream must be restarted for the change to take effect')
            this.publishVideoMode()
            this.updateDeviceState()
        } else {
            this.debug('Received invalid command for video mode')
        }
    }

    publishStreamState(isPublish) {
        ['live', 'event'].forEach(type => {
            const entityProp = (type === 'live') ? 'stream' : `${type}_stream`
            if (this.entity.hasOwnProperty(entityProp)) {
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
            }
        })
    }

    publishEventSelectState(isPublish) {
        if (this.data.event_select.state !== this.data.event_select.publishedState || isPublish) {
            this.data.event_select.publishedState = this.data.event_select.state
            this.mqttPublish(this.entity.event_select.state_topic, this.data.event_select.state)
        }
        const attributes = {
            recordingUrl: this.data.event_select.recordingUrl,
            eventId: this.data.event_select.eventId
        }
        this.mqttPublish(this.entity.event_select.json_attributes_topic, JSON.stringify(attributes), 'attr', '<recording_url_masked>')
    }

    publishDingDurationState(isPublish) {
        const dingTypes = this.device.isDoorbot ? [ 'ding', 'motion' ] : [ 'motion' ]
        dingTypes.forEach(dingType => {
            if (this.data[dingType].duration !== this.data[dingType].publishedDuration || isPublish) {
                this.mqttPublish(this.entity[`${dingType}_duration`].state_topic, this.data[dingType].duration)
                this.data[dingType].publishedDuration = this.data[dingType].duration
            }
        })
    }

    // Publish snapshot image/metadata
    publishSnapshot() {
        // A snapshot refresh triggered by an early push notification can complete before
        // discovery, the image stays cached and is published when the device is published
        if (!this.discoveryPublished) { return }

        this.mqttPublish(this.entity.snapshot.topic, this.data.snapshot.cache, 'mqtt', '<binary_image_data>')
        const attributes = {
            timestamp: this.data.snapshot.timestamp,
            type: this.data.snapshot.cacheType
        }
        this.mqttPublish(this.entity.snapshot.json_attributes_topic, JSON.stringify(attributes), 'attr')
    }

    // Refresh snapshot on scheduled interval
    scheduleSnapshotRefresh() {
        this.data.snapshot.intervalTimerId = setInterval(() => {
            if (this.isOnline() && this.data.snapshot.interval && !(this.data.snapshot.motion && this.data.motion.active_ding)) {
                this.refreshSnapshot('interval')
            }
        }, this.data.snapshot.intervalDuration * 1000)
    }

    async refreshSnapshot(type, image_uuid) {
        let newSnapshot = false
        let loop = 3

        if (this.device.snapshotsAreBlocked) {
            this.debug('Snapshots are unavailable, check if motion capture is disabled manually or via modes settings')
            return
        }

        while (!newSnapshot && loop > 0) {
            try {
                switch (type) {
                    case 'interval':
                    case 'on-demand':
                        this.debug(`Requesting an updated ${type} snapshot`)
                        newSnapshot = await this.device.getNextSnapshot({ force: true })
                        break;
                    case 'motion':
                    case 'ding':
                        if (image_uuid) {
                            this.debug(`Requesting ${type} snapshot using notification image UUID: ${image_uuid}`)
                            newSnapshot = await this.device.getNextSnapshot({ uuid: image_uuid })
                        } else if (!this.device.operatingOnBattery) {
                            this.debug(`Requesting an updated ${type} snapshot`)
                            newSnapshot = await this.device.getNextSnapshot({ force: true })
                        } else {
                            this.debug(`The ${type} notification did not contain image UUID and battery cameras are unable to snapshot while recording`)
                            loop = 0  // Don't retry in this case
                        }
                        break;
                }
            } catch (err) {
                this.debug(err)
                if (loop > 1) {
                    this.debug(`Failed to retrieve updated ${type} snapshot, retrying in one second...`)
                    await utils.sleep(1)
                } else {
                    this.debug(`Failed to retrieve updated ${type} snapshot after three attempts, aborting`)
                }
            }
            loop--
        }

        if (newSnapshot) {
            this.debug(`Successfully retrieved updated ${type} snapshot`)
            this.data.snapshot.cache = newSnapshot
            this.data.snapshot.cacheType = type
            this.data.snapshot.timestamp = Math.round(Date.now()/1000)
            this.publishSnapshot()
        }
    }

    async updateEventStreamUrl() {
        const eventSelect = this.data.event_select.state.split(' ')
        const eventType = eventSelect[0].toLowerCase().replace('-', '_')
        const eventNumber = eventSelect[1]
        const transcoded = Boolean(eventSelect[2] === '(Transcoded)')
        const urlExpired = this.data.event_select.recordingUrlExpire < Date.now()
        let selectedEvent
        let recordingUrl = false

        try {
            const events = await(this.getRecordedEvents(eventType, eventNumber))
            if (events.length >= eventNumber) {
                selectedEvent = events[eventNumber-1]
                if (selectedEvent.event_id !== this.data.event_select.eventId || this.data.event_select.transcoded !== transcoded) {
                    if (this.data.event_select.recordingUrl) {
                        this.debug(`New ${this.data.event_select.state} event detected, updating the recording URL`)
                    }
                    recordingUrl = await this.getRecordingUrl(selectedEvent, transcoded)
                } else if (urlExpired) {
                    this.debug(`Previous ${this.data.event_select.state} URL has expired, updating the recording URL`)
                    recordingUrl = await this.getRecordingUrl(selectedEvent, transcoded)
                }
            } else {
                this.debug(`No event recording corresponding to ${this.data.event_select.state} was found in device event history`)
            }
        } catch(error) {
            this.debug(error)
            this.debug(`Failed to retrieve recording URL for ${this.data.event_select.state} event`)
        }

        if (recordingUrl) {
            this.data.event_select.recordingUrl = recordingUrl
            this.data.event_select.transcoded = transcoded
            this.data.event_select.eventId = selectedEvent.event_id

            try {
                const urlSearch = new URLSearchParams(recordingUrl)
                const amzExpires = Number(urlSearch.get('X-Amz-Expires'))
                const amzDate = parseISO(urlSearch.get('X-Amz-Date'))
                this.data.event_select.recordingUrlExpire = Date.parse(addSeconds(amzDate, amzExpires/3*2))
            } catch {
                this.data.event_select.recordingUrlExpire = Date.now() + 600000
            }
        } else if (urlExpired || !selectedEvent) {
            this.data.event_select.recordingUrl = '<Recording Not Found>'
            this.data.event_select.transcoded = transcoded
            this.data.event_select.eventId = '0'
        }

        return recordingUrl
    }

    async getRecordedEvents(eventType, eventNumber) {
        let events = []
        let paginationKey = false
        let loop = eventType === 'person' ? 4 : 1

        try {
            while (loop > 0) {
                const history = await this.getDeviceHistory({
                    ...paginationKey ? { pagination_key: paginationKey }: {},
                    event_types: eventType === 'person' ? 'motion' : eventType,
                    limit: eventType === 'person' ? 50 : eventNumber
                })

                if (Array.isArray(history.items) && history.items.length > 0) {
                    const newEvents = eventType === 'person'
                        ? history.items.filter(i => i.recording_status === 'ready' && i.cv.person_detected)
                        : history.items.filter(i => i.recording_status === 'ready')
                    events = [...events, ...newEvents]
                }

                // Remove base64 padding characters from pagination key
                paginationKey = history.pagination_key ? history.pagination_key.replace(/={1,2}$/, '') : false

                // If we have enough events, break the loop, otherwise decrease the loop counter
                loop = (events.length >= eventNumber || !history.paginationKey) ? 0 : loop-1
            }
        } catch(error) {
            this.debug(error)
        }

        return events
    }

    async getRecordingUrl(event, transcoded) {
        let recordingUrl
        if (transcoded) {
            recordingUrl = await this.getTranscodedUrl(event)
        } else {
            if (event && Array.isArray(event.visualizations?.cloud_media_visualization?.media)) {
                recordingUrl = (event.visualizations.cloud_media_visualization.media.find(e => e.file_type === 'VIDEO'))?.url
            }
        }
        return recordingUrl
    }

    async getTranscodedUrl(event) {
        let response
        let loop = 60

        try {
            response = await this.device.restClient.request({
                method: 'POST',
                url: 'https://api.ring.com/share_service/v2/transcodings/downloads',
                json: {
                    'ding_id': event.event_id,
                    'file_type': 'VIDEO',
                    'send_push_notification': false
                }
            })

            if (response?.status === 'pending') {
                this.data.event_select.recordingUrl = '<Transcoding in Progress>'
                this.publishEventSelectState()
            }
        } catch(err) {
            this.debug(err)
            this.debug('Request to generate transcoded video failed')
            return false
        }

        while (response?.status === 'pending' && loop > 0) {
            try {
                response = await this.device.restClient.request({
                    method: 'GET',
                    url: `https://api.ring.com/share_service/v2/transcodings/downloads/${event.event_id}?file_type=VIDEO`
                })
            } catch(err) {
                this.debug(err)
                this.debug('Request for transcoded video status failed')
            }
            await utils.sleep(1)
            loop--
        }

        if (response?.status === 'done') {
            return response.result_url
        } else {
            if (loop < 1) {
                this.debug('Timeout waiting for transcoded video to be processed')
            } else {
                this.debug('Failed to retrieve transcoded video URL after 60')
            }
            return false
        }
    }

    // Process messages from MQTT command topic
    processCommand(command, message) {
        const entityKey = command.split('/')[0]
        if (!this.entity.hasOwnProperty(entityKey)) {
            this.debug(`Received message to unknown command topic: ${command}`)
            return
        }

        switch (command) {
            case 'light/command':
                this.setLightState(message)
                break;
            case 'siren/command':
                this.setSirenState(message)
                break;
            case 'video_mode/command':
                this.setVideoMode(message)
                break;
            case 'snapshot_mode/command':
                this.setSnapshotMode(message)
                break;
            case 'snapshot_interval/command':
                this.setSnapshotInterval(message)
                break;
            case 'take_snapshot/command':
                this.takeSnapshot(message)
                break;
            case 'stream/command':
                this.setLiveStreamState(message)
                break;
            case 'event_stream/command':
                this.setEventStreamState(message)
                break;
            case 'event_select/command':
                this.setEventSelect(message)
                break;
            case 'ding_duration/command':
                this.setDingDuration(message, 'ding')
                break;
            case 'motion_detection/command':
                this.setMotionDetectionState(message)
                break;
            case 'motion_warning/command':
                this.setMotionWarningState(message)
                break;
            case 'motion_duration/command':
                this.setDingDuration(message, 'motion')
                break;
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
                await this.device.setLight(Boolean(command === 'on'))
                this.data.light.state = command.toUpperCase()
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
                await this.device.setSiren(Boolean(command === 'on'))
                break;
            default:
                this.debug('Received unknown command for siren')
        }
    }

    // Set switch target state on received MQTT command message
    async setMotionDetectionState(message) {
        this.debug(`Received set motion detection state ${message}`)
        const command = message.toLowerCase()
        try {
            switch (command) {
                case 'on':
                case 'off':
                    await this.device.setDeviceSettings({
                        "motion_settings": {
                            "motion_detection_enabled": Boolean(command === 'on')
                        }
                    })
                    break;
                default:
                    this.debug('Received unknown command for motion detection state')
            }
        } catch(err) {
            if (err.message === 'Response code 404 (Not Found)') {
                this.debug('Shared accounts cannot change motion detection settings!')
            } else {
                this.debug(chalk.yellow(err.message))
                this.debug(err.stack)
            }
        }
    }

    // Set switch target state on received MQTT command message
    async setMotionWarningState(message) {
        this.debug(`Received set motion warning state ${message}`)
        const command = message.toLowerCase()
        try {
            switch (command) {
                case 'on':
                case 'off':
                    await this.device.restClient.request({
                        method: 'PUT',
                        url: this.device.doorbotUrl(`motion_announcement?motion_announcement=${Boolean(command === 'on')}`)
                    })
                    this.mqttPublish(this.entity.motion_warning.state_topic, command === 'on' ? 'ON' : 'OFF')
                    this.data.motion.warning_enabled = Boolean(command === 'on')
                    break;
                default:
                    this.debug('Received unknown command for motion warning state')
            }
        } catch(err) {
            if (err.message === 'Response code 404 (Not Found)') {
                this.debug('Shared accounts cannot change motion warning settings!')
            } else {
                this.debug(chalk.yellow(err.message))
                this.debug(err.stack)
            }
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
            this.data.snapshot.intervalDuration = Math.round(message)
            this.data.snapshot.autoInterval = false
            if (this.data.snapshot.mode === 'Auto') {
                // Creates an array containing only currently active snapshot modes
                const activeModes =
                    (this.device.isDoorbot ? ['Interval', 'Motion', 'Ding'] : ['Interval', 'Motion'])
                        .filter(e => this.data.snapshot[e.toLowerCase()])
                this.data.snapshot.mode = activeModes.length === 0
                    ? 'Disabled' // No snapshot modes are active
                    : activeModes.length === (this.device.isDoorbot ? 3 : 2)
                        ? 'All' // All snapshot modes this device supports are active
                        : activeModes.join(' + ') // Some snapshot modes this device supports are active
                this.updateSnapshotMode()
                this.publishSnapshotMode()
            }
            clearInterval(this.data.snapshot.intervalTimerId)
            this.scheduleSnapshotRefresh()
            this.publishSnapshotInterval()
            this.debug('Snapshot refresh interval has been set to '+this.data.snapshot.intervalDuration+' seconds')
            this.updateDeviceState()
        }
    }

    takeSnapshot(message) {
        if (message.toLowerCase() === 'press') {
            this.debug('Received command to take an on-demand snapshot')
            if (this.data.snapshot.onDemandTimestamp + 10 > Math.round(Date.now()/1000 ) ) {
                this.debug('On-demand snapshots are limited to one snapshot every 10 seconds')
            } else {
                this.data.snapshot.onDemandTimestamp = Math.round(Date.now()/1000)
                this.refreshSnapshot('on-demand')
            }
        } else {
            this.debug(`Received invalid command via on-demand snapshot topic: ${message}`)
        }
    }

    setSnapshotMode(message) {
        this.debug(`Received set snapshot mode to ${message}`)
        const snapshotMode = message.toLowerCase().replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())

        if (this.entity.snapshot_mode.options.map(o => o.includes(snapshotMode))) {
            this.data.snapshot.mode = snapshotMode
            this.data.snapshot.autoInterval = snapshotMode === 'Auto' ? true : this.data.snapshot.autoInterval
            this.updateSnapshotMode()
            this.publishSnapshotMode()

            if (snapshotMode === 'Auto') {
                this.debug(`Snapshot mode has been set to ${snapshotMode}, resetting to default values for camera type`)
                clearInterval(this.data.snapshot.intervalTimerId)
                this.scheduleSnapshotRefresh()
                this.publishSnapshotInterval()
            } else {
                this.debug(`Snapshot mode has been set to ${snapshotMode}`)
            }

            this.updateDeviceState()
        } else {
            this.debug(`Received invalid command for snapshot mode`)
        }
}

    setLiveStreamState(message) {
        const command = message.toLowerCase()
        this.debug(`Received set live stream state ${message}`)
        switch (command) {
            case 'on':
                // An RTSP reader starts a camera on its own, so this only has to
                // cover the case of the switch being turned on with nothing
                // watching. The helper holds the stream open until it is told to
                // let go, which is what the keepalive ffmpeg process used to do
                // by connecting to our own RTSP URL.
                this.debug('Holding the live stream open on request')
                if (!streamer.startStream(this.deviceId)) {
                    this.debug('The stream helper is not connected, cannot start the live stream')
                    this.data.stream.live.status = 'failed'
                    this.publishStreamState()
                }
                break;
            case 'off':
                streamer.stopStream(this.deviceId)
                break;
            default:
                this.debug(`Received unknown command for live stream`)
        }
    }

    // The helper cannot mint a signaling ticket itself: it needs the
    // authenticated Ring session, which lives here.
    async getSignalingTicket() {
        try {
            this.debug('Acquiring a live stream WebRTC signaling session ticket')
            const response = await this.device.restClient.request({
                method: 'POST',
                url: 'https://app.ring.com/api/v1/clap/ticket/request/signalsocket'
            })
            if (!response.ticket) {
                return { error: 'Ring returned no signaling ticket' }
            }
            return { ticket: response.ticket }
        } catch(error) {
            if (error?.response?.statusCode === 403) {
                const blocked = 'Camera returned 403 when starting a live stream.  This usually indicates that live streaming is blocked by Modes settings.  Check your Ring app and verify that you are able to stream from this camera with the current Modes settings.'
                this.debug(blocked)
                return { error: blocked }
            }
            this.debug(error)
            return { error: error.message ? error.message : 'Failed to acquire a signaling ticket' }
        }
    }

    // Stream lifecycle reported by the helper over the control socket.
    onStreamState(type, status) {
        this.data.stream[type].status = status
        this.data.stream[type].session = (status === 'active' || status === 'activating')
        this.publishStreamState()
    }

    setEventStreamState(message) {
        const command = message.toLowerCase()
        this.debug(`Received set event stream state ${message}`)
        switch (command) {
            case 'on':
                // An RTSP reader starts playback on its own, so this only covers
                // the switch being turned on with nothing watching.
                this.debug('Holding the event stream open on request')
                if (!streamer.startStream(this.deviceId, 'event')) {
                    this.debug('The stream helper is not connected, cannot start the event stream')
                    this.data.stream.event.status = 'failed'
                    this.publishStreamState()
                }
                break;
            case 'off':
                streamer.stopStream(this.deviceId, 'event')
                break;
            default:
                this.debug(`Received unknown command for event stream`)
        }
    }

    // Resolve the recording behind the current event selection. The helper plays
    // it back, but only this process can turn a selection into a signed URL.
    async getEventRecording() {
        const eventSelect = this.data.event_select.state.split(' ')
        const eventType = eventSelect[0].toLowerCase().replace('-', '_')
        const eventNumber = eventSelect[1]
        const ordinal = (eventNumber==1?"":eventNumber==2?"2nd ":eventNumber==3?"3rd ":eventNumber+"th ")

        try {
            await this.updateEventStreamUrl()
        } catch(error) {
            this.debug(error)
        }

        if (!this.data.event_select.recordingUrl ||
            this.data.event_select.recordingUrl.match(/Recording Not Found|Transcoding in Progress/)) {
            const message = `No recording available for the ${ordinal}most recent ${eventType} event!`
            this.debug(message)
            return { error: message }
        }

        const description = `the ${ordinal}most recent ${eventType} event`
        this.debug(`Streaming ${description}`)

        return {
            recordingUrl: this.data.event_select.recordingUrl,
            // Ring's downloadable transcodes carry very few keyframes, and an
            // HEVC recording has to come back to H.264 anyway, so both cases are
            // re-encoded on the fly.
            transcode: Boolean(this.data.event_select.transcoded || this.hevcEnabled),
            description
        }
    }

    // Set Stream Select Option
    async setEventSelect(message) {
        this.debug(`Received set event stream to ${message}`)
        if (this.entity.event_select.options.includes(message)) {
            // The playback lives in the helper now, so changing the
            // selection has to tell it to stop rather than killing a local
            // process. data.stream.event.session is a flag, not a handle.
            if (this.data.stream.event.session) {
                streamer.stopStream(this.deviceId, 'event')
            }
            // Set the new value and save the state
            this.data.event_select.state = message
            this.updateDeviceState()
            await this.updateEventStreamUrl()
            this.publishEventSelectState()
        } else {
            this.debug('Received invalid value for event stream')
        }
    }

    setDingDuration(message, dingType) {
        this.debug(`Received set notification duration for ${dingType} events`)
        if (isNaN(message)) {
            this.debug(`New ${dingType} event notificaiton duration value received but is not a number`)
        } else if (!(message >= 10 && message <= 180)) {
            this.debug(`New ${dingType} event notification duration value received but out of range (10-180)`)
        } else {
            this.data[dingType].duration = Math.round(message)
            this.publishDingDurationState()
            this.debug(`Notificaition duration for ${dingType} events has been set to ${this.data[dingType].duration} seconds`)
            this.updateDeviceState()
        }
    }
}
