const debug = require('debug')('ring-mqtt')
const colors = require( 'colors/safe' )
const utils = require( '../lib/utils' )

class Camera {

    constructor(camera, ringTopic) {
        this.camera = camera
        this.subscribed = false

        // Set device location and top level MQTT topics
        this.locationId = this.camera.data.location_id
        this.deviceId = this.camera.data.device_id
        this.cameraTopic = ringTopic+'/'+this.locationId+'/camera'
        this.availabilityTopic = this.cameraTopic+'/'+this.deviceId+'/status'
        this.availabilityState = 'offline'

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


    // Initialize camera by publishing capabilities and state and subscribing to events
    async init(mqttClient) {

        // Publish motion sensor feature for camera
        var capability = {
            type: 'motion',
            component: 'binary_sensor',
            className: 'motion',
            suffix: 'Motion',
            hasCommand: false,
        }
        this.publishCapability(mqttClient, capability)

        // If camera is a doorbell publish doorbell sensor
        if (this.camera.isDoorbot) {
            capability = {
                type: 'ding',
                component: 'binary_sensor',
                className: 'occupancy',
                suffix: 'Ding',
                hasCommand: false
            }
            this.publishCapability(mqttClient, capability)
        }

        // If camera has a light publish light component
        if (this.camera.hasLight) {
            capability = {
                type: 'light',
                component: 'light',
                suffix: 'Light',
                hasCommand: true
            }
            this.publishCapability(mqttClient, capability)
        }

        // If camera has a siren publish switch component
        if (this.camera.hasSiren) {
            capability = {
                type: 'siren',
                component: 'switch',
                suffix: 'Siren',
                hasCommand: true
            }
            this.publishCapability(mqttClient, capability) 
        }

        // Give Home Assistant time to configure device before sending first state data
        await utils.sleep(2)

        // Publish device state and, if new device, subscribe for state updates
        if (!this.subscribed) {
            // Subscribe to Ding events (all cameras have at least motion events)
            this.camera.onNewDing.subscribe(ding => {
                this.publishDingState(mqttClient, ding)
            })
            // Since this is initial publish of device publish ding state as well
            this.publishDingState(mqttClient)

            // If camers as light/siren subsribed to those events as well (only polls, default 20 seconds)
            if (this.camera.hasLight || this.camera.hasSiren) {
                this.camera.onData.subscribe(data => {
                    this.publishPolledState(mqttClient)
                })
            }
            this.subscribed = true

            // Start monitor of availability state for device
            this.monitorCameraConnection(mqttClient)

            // Set camera online (sends availability status via MQTT)
            this.online(mqttClient)
        } else {
            // Pulish all data states and availability state for camera
            this.publishDingState(mqttClient)
            if (this.camera.hasLight || this.camera.hasSiren) {
                if (this.camera.hasLight) { this.publishedLightState = 'republish' }
                if (this.camera.hasSiren) { this.publishedSirenState = 'republish' }
                this.publishPolledState(mqttClient)
            }
            this.publishAvailabilityState(mqttClient)
        }
}

    // Publish state messages via MQTT with optional debug
    publishMqtt(mqttClient, topic, message, enableDebug) {
        if (enableDebug) { debug(topic, message) }
        mqttClient.publish(topic, message, { qos: 1 })
    }

    // Build and publish a Home Assistant MQTT discovery packet for camera capability
    publishCapability(mqttClient, capability) {

        const componentTopic = this.cameraTopic+'/'+capability.component+'/'+this.deviceId
        const configTopic = 'homeassistant/'+capability.component+'/'+this.locationId+'/'+this.deviceId+'_'+capability.type+'/config'

        const message = {
            name: this.camera.name+' '+capability.suffix,
            unique_id: this.deviceId+'_'+capability.type,
            availability_topic: this.availabilityTopic,
            payload_available: 'online',
            payload_not_available: 'offline',
            state_topic: componentTopic+'/'+capability.type+'_state'
        }

        if (capability.className) { message.device_class = capability.className }

        if (capability.hasCommand) {
            const commandTopic = componentTopic+'/'+capability.type+'_command'
            message.command_topic = commandTopic
            mqttClient.subscribe(commandTopic)
        }

        debug('HASS config topic: '+configTopic)
        debug(message)
        mqttClient.publish(configTopic, JSON.stringify(message), { qos: 1 })
    }

    // Process a ding event from camera or publish existing ding state
    async publishDingState(mqttClient, ding) {
        const componentTopic = this.cameraTopic+'/binary_sensor/'+this.deviceId

        // Is it an active ding (i.e. from a subscribed event)?
        if (ding) {
            // Is it a motion or doorbell ding?
            const dingType = ding.kind
            const stateTopic = componentTopic+'/'+dingType+'_state'

            // Update time for most recent ding and expire time of ding (Ring seems to be 180 seconds for all dings)
            this[dingType].last_ding = Math.floor(ding.now)
            this[dingType].ding_duration = ding.expires_in
            // Calculate new expire time for ding (ding.now + ding.expires_in)
            this[dingType].last_ding_expires = this[dingType].last_ding+ding.expires_in
            debug('Ding of type '+dingType+' received at '+ding.now+' from camera '+this.deviceId)

            // Publish MQTT active sensor state
            // Will republish to MQTT for new dings even if ding is already active
            this.publishMqtt(mqttClient, stateTopic, 'ON', true)

            // If ding was not already active, set active ding state property and begin loop
            // to check for ding expiration
            if (!this[dingType].active_ding) {
                this[dingType].active_ding = true
                // Loop until current time is > last_ding expires time.  Sleeps until
                // estimated exire time, but may loop if new dings increase last_ding_expires
                while (Math.floor(Date.now()/1000) < this[dingType].last_ding_expires) {
                    const sleeptime = (this[dingType].last_ding_expires - Math.floor(Date.now()/1000)) + 1
                    debug('Ding of type '+dingType+' from camera '+this.deviceId+' expires in '+sleeptime)
                    await utils.sleep(sleeptime)
                    debug('Ding of type '+dingType+' from camera '+this.deviceId+' exired')
                }
                // All dings have expired, set state back to false/off
                debug('All dings of type '+dingType+' from camera '+this.deviceId+' have expired')
                this[dingType].active_ding = false
                this.publishMqtt(mqttClient, stateTopic, 'OFF', true)
            }
        } else {
            // Not an active ding so just publish existing ding state
            this.publishMqtt(mqttClient, componentTopic+'/motion_state', (this.motion.active_ding ? 'ON' : 'OFF'), true)
            if (this.camera.isDoorbot) {
                this.publishMqtt(mqttClient, componentTopic+'/ding_state', (this.ding.active_ding ? 'ON' : 'OFF'), true)
            }
        }
    }

    // Publish camera state for polled attributes (light/siren state, etc)
    // Writes state to custom property to keep from publishing state except
    // when values change from previous polling interval
    publishPolledState(mqttClient) {
        if (this.camera.hasLight) {
            const componentTopic = this.cameraTopic+'/light/'+this.deviceId
            const stateTopic = componentTopic+'/light_state'
            if (this.camera.data.led_status !== this.publishedLightState) {
                this.publishMqtt(mqttClient, stateTopic, (this.camera.data.led_status === 'on' ? 'ON' : 'OFF'), true)
                this.publishedLightState = this.camera.data.led_status
            }
        }
        if (this.camera.hasSiren) {
            const componentTopic = this.cameraTopic+'/switch/'+this.deviceId
            const stateTopic = componentTopic+'/siren_state'
            const sirenStatus = this.camera.data.siren_status.seconds_remaining > 0 ? 'ON' : 'OFF'
            if (sirenStatus !== this.publishedSirenState) {
                this.publishMqtt(mqttClient, stateTopic, sirenStatus, true)
                this.publishedSirenState = sirenStatus
            }
        }
    }

    // Interval loop to check communications with cameras/Ring API since, unlike alarm,
    // there's no websocket to monitor.
    // Also monitor subscriptions to ding/motion events and attempt resubscribe if false
    monitorCameraConnection(mqttClient) {
        const _this = this
        setInterval(async function() {
            const camera = _this.camera

            // Query camera heath, if health data doesn't return in 5 seconds assume camera is offline
            const deviceHealth = await Promise.race([camera.getHealth(), utils.sleep(5)]).then(function(result) {
                return result;
            });
            const cameraState = (deviceHealth) ? 'online' : 'offline'

            // Publish camera availability state if different from prior state
            if (_this.availabilityState !== cameraState) {
                if (cameraState == 'offline') {
                    _this.offline(mqttClient)
                } else {
                    // If camera switching to online republish discovery and state before going online
                    _this.init(mqttClient)
                    await utils.sleep(2)
                    _this.online(mqttClient)
                }
            }

            // Check for subscription to ding and motion events and attempt to resubscribe
            if (!camera.data.subscribed === true) {
                debug('Camera Id '+camera.data.device_id+' lost subscription to ding events, attempting to resubscribe...')
                camera.subscribeToDingEvents().catch(e => { 
                    debug('Failed to resubscribe camera Id ' +camera.data.device_id+' to ding events. Will retry in 60 seconds.') 
                    debug(e)
                })
            }
            if (!camera.data.subscribed_motions === true) {
                debug('Camera Id '+camera.data.device_id+' lost subscription to motion events, attempting to resubscribe...')
                camera.subscribeToMotionEvents().catch(e => {
                    debug('Failed to resubscribe camera Id '+camera.data.device_id+' to motion events.  Will retry in 60 seconds.')
                    debug(e)
                })
            }
        }, 60000)
    }

    // Process messages from MQTT command topic
    processCommand(message, cmdTopicLevel) {
        switch(cmdTopicLevel) {
            case 'light_command':
                this.setLightState(message)
                break;
            case 'siren_command':
                this.setSirenState(message)
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
                debug('Received unkonw command for light on camera ID '+this.deviceId)
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

    // Publish availability state
    publishAvailabilityState(mqttClient, enableDebug) {
        this.publishMqtt(mqttClient, this.availabilityTopic, this.availabilityState, enableDebug)
    }

    // Set state topic online
    async online(mqttClient) {
        const enableDebug = this.availabilityState !== 'online'
        await utils.sleep(1)
        this.availabilityState = 'online'
        this.publishAvailabilityState(mqttClient, enableDebug)
    }

    // Set state topic offline
    offline(mqttClient) {
        const enableDebug = this.availabilityState !== 'offline'
        this.availabilityState = 'offline'
        this.publishAvailabilityState(mqttClient, enableDebug)
    }
}

module.exports = Camera
