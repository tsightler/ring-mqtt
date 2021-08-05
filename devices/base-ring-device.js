const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

class RingDevice {

    async publishDiscovery() {
        Object.keys(this.entities).forEach(entity => {
            const entityTopic = `${this.deviceTopic}/${entity}`
            const entityId = this.entities[entity].hasOwnProperty('id') ? this.entities[entity].id : `${this.deviceId}_${entity}`
            const deviceName = this.entities[entity].hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${this.entities[entity].suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entity.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            let discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            switch (this.entities[entity].type) {
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
                        value_template: this.entities[entity].value_template,
                        unit_of_measure: this.entities[entity].max,
                        icon: 'mdi:information-outline'
                    }
                    break;
                case 'number':
                    discoveryMessage = {
                        ...discoveryMessage,
                        state_topic: `${entityTopic}/state`,
                        command_topic: `${entityTopic}/command`,
                        min: this.entities[entity].min,
                        max: this.entities[entity].max
                    }
                    break;
            }

            // Save state/command topics to entity properties for later use
            if (!this.entities[entity].hasOwnProperty('stateTopic')) {
                this.entities[entity].stateTopic = `${entityTopic}/state`
                if (discoveryMessage.hasOwnProperty('command_topic')) {
                    this.entities[entity].commandTopic = discoveryMessage.command_topic
                    this.mqttClient.subscribe(this.entities[entity].commandTopic)
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