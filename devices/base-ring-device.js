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

            // Due to legacy reasons alarm devices with only a single primary entity, as
            // well as the alarm control panel entity, use a device ID without a suffix.
            // The info sensor, as well as all other entities, append the entityName as a
            // suffix to create a unique entity ID from the device ID.
            //
            // One day I want to get rid of this and generate unique entity IDs with suffixes
            // for all entities but it's a breaking change for upgrading users so, for now,
            // the logic below maintains device ID compatibility with older versions.
            //
            // I need to research if there's a way to deal with this without breaking updates.
            // Maybe a transition period with both IDs in the device data?
            const entityId = ((Object.keys(this.entities).length <= 2 && entityName !== 'info') || entity.component === 'alarm_control_panel')
                ? this.deviceId
                : `${this.deviceId}_${entityName}`
            
            // If defined, append a custom suffix to the device name, otherwise, if the
            // device has more than a single primary entity, suffix with entity name with
            // a generated name based on entityName
            // For devices with a single entity, only the info sensor gets a suffix
            const deviceName = entity.hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${entity.suffix}`
                : Object.keys(this.entities).length <= 2 && entityName !== 'info'
                    ? `${this.deviceData.name}`
                    : `${this.deviceData.name} ${entityName.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`

            // Build the discovery message
            let discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                ...entity.component === 'camera' 
                    ? { topic: entityStateTopic }
                    : { state_topic: entityStateTopic },
                ...entity.component.match(/^(switch|number|light)$/)
                    ? { command_topic: `${entityTopic}/command` } : {},
                ...entity.hasOwnProperty('device_class')
                    ? { device_class: entity.device_class } : {},
                ...entity.hasOwnProperty('unit_of_measurement')
                    ? { unit_of_measurement: entity.unit_of_measurement } : {},
                ...entity.hasOwnProperty('state_class')
                    ? { state_class: entity.state_class } : {},
                ...entity.hasOwnProperty('value_template')
                    ? { value_template: entity.value_template } : {},
                ...entity.hasOwnProperty('min')
                    ? { min: entity.min } : {},
                ...entity.hasOwnProperty('max')
                    ? { max: entity.max } : {},
                ...entity.hasOwnProperty('attributes')
                    ? { json_attributes_topic: `${entityTopic}/attributes` } 
                    : entityName === "info"
                        ? { json_attributes_topic: `${entityStateTopic}` } : {},
                ...entity.hasOwnProperty('icon')
                    ? { icon: entity.icon } 
                    : entityName === "info" 
                        ? { icon: 'mdi:information-outline' } : {},
                device: this.deviceData
            }

            // On first discovery save all generated topics to entity properties
            if (!this.entities[entityName].hasOwnProperty('state_topic')) {
                this.entities[entityName].state_topic = entityStateTopic
                if (discoveryMessage.hasOwnProperty('command_topic')) {
                    this.entities[entityName].command_topic = discoveryMessage.command_topic
                    this.mqttClient.subscribe(discoveryMessage.command_topic)  // Subscribe to command topics
                }
                if (discoveryMessage.hasOwnProperty('json_attributes_topic')) {
                    this.entities[entityName].json_attributes_topic = discoveryMessage.json_attributes_topic
                }
            }

            const configTopic = `homeassistant/${entity.component}/${this.locationId}/${entityId}/config`
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