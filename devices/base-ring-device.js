const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

// Base class with functions common to all devices
class RingDevice {
    constructor(deviceInfo) {
        this.device = deviceInfo.device
        this.mqttClient = deviceInfo.mqttClient
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
            const entityStateTopic = entity.hasOwnProperty('parentStateTopic')
                ? `${this.deviceTopic}/${entity.parentStateTopic}`
                : entity.type === 'camera'
                    ? `${entityTopic}/image`
                    : `${entityTopic}/state`

            // Due to legacy reasons, devices with a single entity, as well as the
            // alarm control panel entity, use a device ID without a suffix.  All
            // other devices append the entityName as suffix to create a unique ID.
            // I'd love to get rid of this one day, but it's a breaking change for
            // upgrading users so this logic maintains compatibility
            const entityId = (Object.keys(this.entities).length > 1 && entity.type !== 'alarm_control_panel')
                ? `${this.deviceId}_${entityName}`
                : this.deviceId
            
            // Use a custom name suffix if provided, otherwise, if device has more than one entity, suffix with entity name
            const deviceName = entity.hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${entity.suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entityName.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            // Build the discovery message
            let discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                ...entity.type === 'camera' 
                    ? { topic: entityStateTopic }
                    : { state_topic: entityStateTopic },
                ...entity.type.match(/^(switch|number|light)$/)
                    ? { command_topic: `${entityTopic}/command` } : {},
                ...entity.hasOwnProperty('deviceClass')
                    ? { device_class: entity.deviceClass } : {},
                ...entity.hasOwnProperty('unitOfMeasurement')
                    ? { unit_of_measurement: entity.unitOfMeasurement } : {},
                ...entity.hasOwnProperty('valueTemplate')
                    ? { value_template: entity.valueTemplate } : {},
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
            if (!this.entities[entityName].hasOwnProperty('stateTopic')) {
                this.entities[entityName].stateTopic = entityStateTopic
                if (discoveryMessage.hasOwnProperty('command_topic')) {
                    this.entities[entityName].commandTopic = discoveryMessage.command_topic
                    this.mqttClient.subscribe(discoveryMessage.command_topic)  // Subscribe to command topics
                }
                if (discoveryMessage.hasOwnProperty('json_attributes_topic')) {
                    this.entities[entityName].attributesTopic = discoveryMessage.json_attributes_topic
                }
            }

            const configTopic = `homeassistant/${entity.type}/${this.locationId}/${entityId}/config`
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