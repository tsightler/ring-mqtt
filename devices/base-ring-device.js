const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

// Base class with functions common to all devices
class RingDevice {
    constructor(deviceInfo, deviceId, locationId) {
        this.device = deviceInfo.device
        this.mqttClient = deviceInfo.mqttClient
        this.deviceId = deviceId
        this.locationId = locationId
        this.subscribed = false
        this.availabilityState = 'init'
        this.config = deviceInfo.CONFIG
        this.entities = {}

        // Build device base and availability topic
        this.deviceTopic = `${this.config.ring_topic}/${this.locationId}/${deviceInfo.category}/${this.deviceId}`
        this.availabilityTopic = `${this.deviceTopic}/status`
    }

    // This function loops through each entity of the device, generates
    // a unique device ID for each and build state, command and attribute topics.
    // Finally it generates a Home Assistant MQTT discovery message for the entity
    // and publishes this message to the config topic
    async publishDiscovery() {
        Object.keys(this.entities).forEach(entityName => {
            const entity = this.entities[entityName]
            const entityTopic = `${this.deviceTopic}/${entityName}`

            // If this entity uses state values from a parent entity set this here
            // otherwise use standard state topic for entity ('image' for camera, 'state' for all others)
            const entityStateTopic = entity.hasOwnProperty('parent_state_topic')
                ? `${this.deviceTopic}/${entity.parent_state_topic}`
                : entity.component === 'camera'
                    ? `${entityTopic}/image`
                    : `${entityTopic}/state`
            
            // ***** Build a Home Assistant style MQTT discovery message *****
            // Legacy versions of ring-mqtt created entity names and IDs for single function devices
            // without using any type of suffix. To maintain compatibility with older version entities
            // can pass their unique_id in the entity definition. If this is detected then the device
            // will also get legacy device name generation (i.e. no name suffix either). However,
            // automatic name generation can also be completely overridden with entity 'name' parameter.
            //
            // I know the below will offend the sensibilities of some people, especially with regards
            // to formatting, but, for whatever reason, my brain reads through it easily and parses the
            // logic out easily, so I went with it.
            let discoveryMessage = {
                ... entity.hasOwnProperty('name')
                    ? { name: entity.name }
                    : entity.hasOwnProperty('unique_id')
                        ? { name: `${this.deviceData.name}` }
                        : { name: `${this.deviceData.name} ${entityName.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}` },
                ... entity.hasOwnProperty('unique_id') // Required for legacy entity ID compatibility
                    ? { unique_id: entity.unique_id }
                    : { unique_id: `${this.deviceId}_${entityName}` },
                ... entity.component === 'camera' 
                    ? { topic: entityStateTopic }
                    : { state_topic: entityStateTopic },
                ... entity.component.match(/^(switch|number|light|fan|lock|alarm_control_panel)$/)
                    ? { command_topic: `${entityTopic}/command` } : {},
                ... entity.hasOwnProperty('device_class')
                    ? { device_class: entity.device_class } : {},
                ... entity.hasOwnProperty('unit_of_measurement')
                    ? { unit_of_measurement: entity.unit_of_measurement } : {},
                ... entity.hasOwnProperty('state_class')
                    ? { state_class: entity.state_class } : {},
                ... entity.hasOwnProperty('value_template')
                    ? { value_template: entity.value_template } : {},
                ... entity.hasOwnProperty('min')
                    ? { min: entity.min } : {},
                ... entity.hasOwnProperty('max')
                    ? { max: entity.max } : {},
                ... entity.hasOwnProperty('attributes')
                    ? { json_attributes_topic: `${entityTopic}/attributes` } 
                    : entityName === "info"
                        ? { json_attributes_topic: `${entityStateTopic}` } : {},
                ... entity.hasOwnProperty('icon')
                    ? { icon: entity.icon } 
                    : entityName === "info" 
                        ? { icon: 'mdi:information-outline' } : {},
                ... entity.component === 'alarm_control_panel' && this.config.disarm_code
                    ? { code: this.config.disarm_code.toString(),
                        code_arm_required: false,
                        code_disarm_required: true } : {},
                ... entity.hasOwnProperty('brightness_scale')
                    ? { brightness_state_topic: `${entityTopic}/brightness_state`, 
                        brightness_command_topic: `${entityTopic}/brightness_command`,
                        brightness_scale: entity.brightness_scale } : {},
                ... entity.component === 'fan'
                    ? { percentage_state_topic: `${entityTopic}/percent_speed_state`,
                        percentage_command_topic: `${entityTopic}/percent_speed_command`,
                        preset_mode_state_topic: `${entityTopic}/speed_state`,
                        preset_mode_command_topic: `${entityTopic}/speed_command`,
                        preset_modes: [ "low", "medium", "high" ],
                        speed_range_min: 11,
                        speed_range_max: 100 } : {},
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            // On the first publish store the generated topics in the entities object and perform
            // one-time operations such as subscribing to command topics
            if (!(this.entities[entityName].hasOwnProperty('state_topic') || this.entities[entityName].hasOwnProperty('topic'))) {
                // State topics (except cameras)
                Object.keys(discoveryMessage).filter(property => property.match('state_topic')).forEach(stateTopic => {
                    this.entities[entityName][stateTopic] = discoveryMessage[stateTopic]
                })

                // Since cameras send binary image data rather than "state", they use topic vs state_topic, yay!
                if (entity.component === 'camera') {
                    this.entities[entityName].topic = discoveryMessage.topic
                }                

                // Command topics (including subscribe)
                Object.keys(discoveryMessage).filter(property => property.match('command_topic')).forEach(commandTopic => {
                    this.entities[entityName][commandTopic] = discoveryMessage[commandTopic]
                    this.mqttClient.subscribe(discoveryMessage[commandTopic])
                })

                // JSON Attributes topic
                if (discoveryMessage.hasOwnProperty('json_attributes_topic')) {
                    this.entities[entityName].json_attributes_topic = discoveryMessage.json_attributes_topic
                }
            }

            const configTopic = `homeassistant/${entity.component}/${this.locationId}/${discoveryMessage.unique_id}/config`
            debug(`HASS config topic: ${configTopic}`)
            debug(discoveryMessage)
            this.publishMqtt(configTopic, JSON.stringify(discoveryMessage))
        })
        // Sleep for a few seconds to give HA time to process discovery message
        await utils.sleep(2)
    }

    // Publish state messages with debug
    publishMqtt(topic, message, isDebug) {
        if (isDebug) { debug(topic, message) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Publish availability state
    publishAvailabilityState(enableDebug) {
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
    }

    // Set state topic online
    async online() {
        const enableDebug = (this.availabilityState === 'online') ? false : true
        await utils.sleep(1)
        this.availabilityState = 'online'
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

module.exports = RingDevice