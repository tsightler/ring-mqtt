const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

class RingDevice {

    async publishDiscovery() {
        Object.keys(this.entities).forEach(entityKey => {
            const entity = this.entities[entityName]
            const entityTopic = `${this.deviceTopic}/${entityName}`
            const entityId = entity.hasOwnProperty('id') ? entity.id : `${this.deviceId}_${entityName}`
            const deviceName = entity.hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${entity.suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entityName.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            let discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            switch (entity.type) {
                case 'switch':
                    discoveryMessage = {
                        ...discoveryMessage,
                        state_topic: `${entityTopic}/state`,
                        command_topic: `${entityTopic}/command`
                    }
                    break;
                case 'sensor':
                    discoveryMessage = {
                        ...discoveryMessage,
                        state_topic: `${entityTopic}/state`,
                        json_attributes_topic: `${entityTopic}/state`,
                        ...entity.hasOwnPoperty('valueTemplate') ? { value_template: entity.valueTemplate } : {},
                        ...entity.hasOwnPoperty('unitOfMeasure') ? { unit_of_measure: entity.unitOfMeasure } : {},
                        ...entity.hasOwnPoperty('icon') ? { icon: entity.icon } : { icon: 'mdi:information-outline' }
                    }
                    break;
                case 'number':
                    discoveryMessage = {
                        ...discoveryMessage,
                        state_topic: `${entityTopic}/state`,
                        command_topic: `${entityTopic}/command`,
                        ...entity.hasOwnPoperty('min') ? { min: entity.min } : {},
                        ...entity.hasOwnPoperty('max') ? { max: entity.max } : {}
                    }
                    break;
            }

            // On first discovery save the generated state/command topics to
            // entity properties and subscribe to any command topics
            if (!this.entities[entityName].hasOwnProperty('stateTopic')) {
                this.entities[entityName].stateTopic = `${entityTopic}/state`
                if (discoveryMessage.hasOwnProperty('command_topic')) {
                    this.entities[entityName].commandTopic = discoveryMessage.command_topic
                    this.mqttClient.subscribe(this.entities[entityName].commandTopic)
                }
            }

            const configTopic = `homeassistant/${this.entities[entity].type}/${this.locationId}/${entityId}/config`
            debug('HASS config topic: '+configTopic)
            debug(discoveryMessage)
            this.publishMqtt(configTopic, JSON.stringify(discoveryMessage))
        })
        // Sleep for a few seconds to give HA time to process discovery message
        await utils.sleep(2)
    }
}

module.exports = RingDevice