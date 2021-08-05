const debug = require('debug')('ring-mqtt')
const utils = require('../lib/utils')

class BaseDevice {

    async publishDiscovery() {
        Object.keys(this.entities).forEach(entity => {
            const entityTopic = `${this.deviceTopic}/${entity}`
            const entityId = this.entities[entity].hasOwnProperty('id') ? this.entities[entity].id : `${this.deviceId}_${entity}`
            const deviceName = this.entities[entity].hasOwnProperty('suffix')
                ?  `${this.deviceData.name} ${this.entities[entity].suffix}`
                : Object.keys(this.entities).length > 1
                    ? `${this.deviceData.name} ${entity.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}`
                    : `${this.deviceData.name}`

            const discoveryMessage = {
                name: deviceName,
                unique_id: entityId,
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            switch (this.entities[entity].type) {
                case 'switch':
                    discoveryMessage.state_topic = `${entityTopic}/state`
                    discoveryMessage.command_topic = `${entityTopic}/command`
                    break;
                case 'sensor':
                    discoveryMessage.state_topic = `${entityTopic}/state`
                    discoveryMessage.json_attributes_topic = `${entityTopic}/state`
                    discoveryMessage.icon = 'mdi:information-outline'
                    break;
                case 'number':
                    discoveryMessage.state_topic = `${entityTopic}/state`
                    discoveryMessage.command_topic = `${entityTopic}/command`
                    discoveryMessage.min = this.entities[entity].min
                    discoveryMessage.max = this.entities[entity].max
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

module.exports = BaseDevice