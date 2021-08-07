const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

// Base class with functions common to all devices
class RingDevice {

    // This function loops through each entity of the device, generates
    // a unique device ID for each one and creates the state/command topics.
    // Finally it generates a Home Assistant MQTT discovery message for the entity
    // and publishes this message to the config topic
    async publishDevice() {
        Object.keys(this.entities).forEach(entityName => {
            const entity = this.entities[entityName]

            let entityTopic = `${this.deviceTopic}/${entityName}`
            if (entity.hasOwnProperty('parentAttributeEntity')) {
                entityTopic = `${this.deviceTopic}/${entity.parentAttributeEntity}`
            }

            // Due to legacy reasons, devices with a single entity, as well as the alarm control panel
            // entity, use the device ID without a suffix as the unique ID.  All other devices append
            // the entityName as suffix to create a unique ID.
            const entityId = (Object.keys(this.entities).length > 1 && entity.type !== 'alarm_control_panel')
                ? `${this.deviceId}_${entityName}`
                : this.deviceId
            
            // Use a custom name suffix if provided, otherwise add entityName if device has more than one entity
            const deviceName = entity.hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${entity.suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entityName.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            // Set (mostly) universal values
            let discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                state_topic: `${entityTopic}/state`,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                ...entity.hasOwnProperty('jsonAttributes') ? { json_attributes_topic: `${entityTopic}/attributes` } : {},
                device: this.deviceData
            }

            switch (entity.type) {
                case 'binary_sensor':
                    discoveryMessage = {
                        ...discoveryMessage,
                        ...entity.hasOwnProperty('deviceClass') ? { device_class: entity.deviceClass } : {},
                        ...entity.hasOwnProperty('icon') ? { icon: entity.icon } : {}
                    }
                    break;
                case 'switch':
                    discoveryMessage = {
                        ...discoveryMessage,
                        command_topic: `${entityTopic}/command`,
                        ...entity.hasOwnProperty('icon') ? { icon: entity.icon } : {}
                    }
                    break;
                case 'sensor':
                    discoveryMessage = {
                        ...discoveryMessage,
                        ...entity.hasOwnProperty('attribute') ? {} : { json_attributes_topic: `${entityTopic}/state` },
                        ...entity.hasOwnProperty('valueTemplate') ? { value_template: entity.valueTemplate } : {},
                        ...entity.hasOwnProperty('deviceClass') ? { device_class: entity.deviceClass } : {},
                        ...entity.hasOwnProperty('unitOfMeasurement') ? { unit_of_measurement: entity.unitOfMeasurement } : {},
                        ...entity.hasOwnProperty('icon')
                            ? { icon: entity.icon } 
                            : entity.hasOwnProperty('deviceClass') && entityName !== "info" ? {} : { icon: 'mdi:information-outline' }
                    }
                    break;
                case 'number':
                    discoveryMessage = {
                        ...discoveryMessage,
                        command_topic: `${entityTopic}/command`,
                        ...entity.hasOwnProperty('min') ? { min: entity.min } : {},
                        ...entity.hasOwnProperty('max') ? { max: entity.max } : {},
                        ...entity.hasOwnProperty('icon') ? { icon: entity.icon } : {}
                    }
                    break;
                case 'light':
                    discoveryMessage = {
                        ...discoveryMessage,
                        command_topic: `${entityTopic}/command`,
                        ...entity.hasOwnProperty('icon') ? { icon: entity.icon } : {}
                    }
                    break;
                case 'camera':
                    delete discoveryMessage.state_topic
                    discoveryMessage = {
                        ...discoveryMessage,
                        topic: `${entityTopic}/image`
                    }
                    break;
            }

            // On first discovery save the generated state/command topics to
            // entity properties and subscribe to any command topics
            if (!this.entities[entityName].hasOwnProperty('stateTopic')) {
                this.entities[entityName].stateTopic = `${entityTopic}/state`
                if (discoveryMessage.hasOwnProperty('command_topic')) {
                    this.entities[entityName].commandTopic = `${entityTopic}/command`
                    this.mqttClient.subscribe(this.entities[entityName].commandTopic)
                }
            }

            const configTopic = `homeassistant/${entity.type}/${this.locationId}/${entityId}/config`
            debug('HASS config topic: '+configTopic)
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