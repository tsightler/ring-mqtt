const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')
const colors = require('colors/safe')

// Base class with functions common to all devices
class RingDevice {
    constructor(deviceInfo, deviceId, locationId, primaryAttribute) {
        this.device = deviceInfo.device
        this.mqttClient = deviceInfo.mqttClient
        this.config = deviceInfo.CONFIG
        this.deviceId = deviceId
        this.locationId = locationId
        this.availabilityState = 'unpublished'
        this.isOnline = () => { return this.availabilityState === 'online' ? true : false }
        this.entity = {}

        // Build device base and availability topic
        this.deviceTopic = `${this.config.ring_topic}/${this.locationId}/${deviceInfo.category}/${this.deviceId}`
        this.availabilityTopic = `${this.deviceTopic}/status`

        if (primaryAttribute !== 'disable') {
            this.initAttributeEntities(primaryAttribute)
            this.schedulePublishAttributes()
        }
    }

    // This function loops through each entity of the device, creates a unique
    // device ID for each one, and builds state, command, and attribute topics.
    // Finally it generates a Home Assistant MQTT discovery message for the entity
    // and publishes this message to the Home Assistant config topic
    async publishDiscovery() {
        const debugMsg = (this.availabilityState === 'unpublished') ? 'Publishing new ' : 'Republishing existing '
        debug(debugMsg+'device id: '+this.deviceId)

        Object.keys(this.entity).forEach(entityKey => {
            const entity = this.entity[entityKey]
            const entityTopic = `${this.deviceTopic}/${entityKey}`

            // If this entity uses state values from the attributes of a parent entity set that here,
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
            // to formatting, but, for whatever reason, my brain reads through it linerarly and parses
            // the logic out easily, so I went with it.
            let discoveryMessage = {
                ... entity.hasOwnProperty('name')
                    ? { name: entity.name }
                    : entity.hasOwnProperty('isLegacyEntity') || this.deviceData.name.toLowerCase().match(entityKey) // Use legacy name generation
                        ? { name: `${this.deviceData.name}` }
                        : { name: `${this.deviceData.name} ${entityKey.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}` },
                ... entity.hasOwnProperty('unique_id') // If device provides own unique_id use that in all cases
                    ? { unique_id: entity.unique_id }
                    : entity.hasOwnProperty('isLegacyEntity') // Use legacy entity ID generation
                        ? { unique_id: `${this.deviceId}` }
                        : { unique_id: `${this.deviceId}_${entityKey}` },
                ... entity.component === 'camera' 
                    ? { topic: entityStateTopic }
                    : entity.component === 'climate'
                        ? { mode_state_topic: entityStateTopic }
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
                    : entityKey === "info"
                        ? { json_attributes_topic: `${entityStateTopic}` } : {},
                ... entity.hasOwnProperty('icon')
                    ? { icon: entity.icon } 
                    : entityKey === "info" 
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
                ... entity.component === 'climate'
                    ? { action_topic: `${entityTopic}/action_state`,
                        aux_state_topic: `${entityTopic}/aux_state`,
                        aux_command_topic: `${entityTopic}/aux_command`,
                        current_temperature_topic: `${entityTopic}/current_temperature_state`,
                        fan_modes: entity.fan_modes,
                        fan_mode_state_topic: `${entityTopic}/fan_mode_state`,
                        fan_mode_command_topic: `${entityTopic}/fan_mode_command`,
                        max_temp: 37,
                        min_temp: 10,
                        modes: ["off", "cool", "heat"],
                        mode_state_topic: `${entityTopic}/mode_state`,
                        mode_command_topic: `${entityTopic}/mode_command`,
                        temperature_state_topic: `${entityTopic}/temperature_state`,
                        temperature_command_topic: `${entityTopic}/temperature_command`,
                        temperature_unit: 'C' } : {},
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            const configTopic = `homeassistant/${entity.component}/${this.locationId}/${this.deviceId}_${entityKey}/config`
            debug(`HASS config topic: ${configTopic}`)
            debug(discoveryMessage)
            this.publishMqtt(configTopic, JSON.stringify(discoveryMessage))

            // On first publish store generated topics in entities object and subscribe to command topics
            if (!this.entity[entityKey].hasOwnProperty('published')) {
                this.entity[entityKey].published = true
                Object.keys(discoveryMessage).filter(property => property.match('topic')).forEach(topic => {
                    this.entity[entityKey][topic] = discoveryMessage[topic]
                    if (topic.match('command_topic')) {
                        this.mqttClient.subscribe(discoveryMessage[topic])
                    }
                })
            }
        })
        // Sleep for a few seconds to give HA time to process discovery message
        await utils.sleep(2)
    }

    // Refresh device info attributes on a sechedule
    async schedulePublishAttributes() {
        await utils.sleep(this.availabilityState === 'offline' ? 60 : 300)
        if (this.availabilityState === 'online') {
            this.publishAttributes()
        }
        this.schedulePublishAttributes()
    }

    publishAttributeEntities(attributes) {
        // Find any attribute entities and publish the matching subset of attributes
        Object.keys(this.entity).forEach(entityKey => {
            if (this.entity[entityKey].hasOwnProperty('attributes') && this.entity[entityKey].attributes !== true) {
                const entityAttributes = Object.keys(attributes)
                    .filter(key => key.match(this.entity[entityKey].attributes.toLowerCase()))
                    .reduce((filteredAttributes, key) => {
                        filteredAttributes[key] = attributes[key]
                        return filteredAttributes
                    }, {})
                if (Object.keys(entityAttributes).length > 0) {
                    this.publishMqtt(this.entity[entityKey].json_attributes_topic, JSON.stringify(entityAttributes), true)
                }
            }
        })
    }

    // Publish state messages with debug
    publishMqtt(topic, message, isDebug) {
        if (isDebug) { debug(colors.brightBlue(`[${this.deviceData.name}]`)+' '+colors.grey(`${topic}`)+' '+colors.cyan(`${message}`)) }
        this.mqttClient.publish(topic, message, { qos: 1 })
    }

    // Publish availability state
    publishAvailabilityState(enableDebug) {
        this.publishMqtt(this.availabilityTopic, this.availabilityState, enableDebug)
    }

    // Set state topic online
    async online() {
        const enableDebug = (this.availabilityState === 'online') ? false : true
        if (this.shutdown) { return }
        this.availabilityState = 'online'
        this.publishAvailabilityState(enableDebug)
        await utils.sleep(2)
    }

    // Set state topic offline
    offline() {
        const enableDebug = (this.availabilityState === 'offline') ? false : true
        this.availabilityState = 'offline'
        this.publishAvailabilityState(enableDebug)
    }
}

module.exports = RingDevice