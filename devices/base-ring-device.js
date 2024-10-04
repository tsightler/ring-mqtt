import utils from '../lib/utils.js'
import state from '../lib/state.js'
import chalk from 'chalk'

// Base class with functions common to all devices
export default class RingDevice {
    constructor(deviceInfo, category, primaryAttribute, apiType) {
        this.device = deviceInfo.device
        this.deviceId = apiType === 'socket' ? deviceInfo.device.id : deviceInfo.device.data.device_id
        this.locationId = apiType === 'socket' ? deviceInfo.device.location.locationId : deviceInfo.device.data.location_id
        this.availabilityState = 'unpublished'
        this.entity = {}
        this.isOnline = () => {
            return this.availabilityState === 'online' ? true : false
        }

        this.debug = (message, debugType) => {
            utils.debug(debugType === 'disc' ? message : chalk.green(`[${this.deviceData.name}] `)+message, debugType || 'mqtt')
        }
        // Build device base and availability topic
        this.deviceTopic = `${utils.config().ring_topic}/${this.locationId}/${category}/${this.deviceId}`
        this.availabilityTopic = `${this.deviceTopic}/status`

        if (deviceInfo.hasOwnProperty('parentDevice')) {
            this.parentDevice = deviceInfo.parentDevice
        }

        if (deviceInfo.hasOwnProperty('childDevices')) {
            this.childDevices = deviceInfo.childDevices
        }

        if (primaryAttribute !== 'disable') {
            this.initAttributeEntities(primaryAttribute)
            this.schedulePublishAttributes()
        }
    }

    // This function loops through each entity of the device, creates a unique
    // device ID for each one, builds the required state, command, and attribute
    // topics and, finally, generates a Home Assistant MQTT discovery message for
    // the entity and publishes this message to the Home Assistant config topic
    async publishDiscovery() {
        const debugMsg = (this.availabilityState === 'unpublished') ? 'Publishing new ' : 'Republishing existing '
        this.debug(debugMsg+'device id: '+this.deviceId, 'disc')

        Object.keys(this.entity).forEach(entityKey => {
            const entity = this.entity[entityKey]
            const entityTopic = `${this.deviceTopic}/${entityKey}`

            // If this entity uses state values from the JSON attributes of a parent entity use that topic,
            // otherwise use standard state topic for entity ('image' for camera, 'state' for all others)
            const entityStateTopic = entity.hasOwnProperty('parent_state_topic')
                ? `${this.deviceTopic}/${entity.parent_state_topic}`
                : entity.component === 'camera'
                    ? `${entityTopic}/image`
                    : `${entityTopic}/state`

            // Build a Home Assistant style MQTT discovery message for the entity
            let discoveryMessage = {
                ...entity.hasOwnProperty('isMainEntity') || entity.hasOwnProperty('name')
                    ? { name: entity.hasOwnProperty('name') ? entity.name : '' }
                    : { name: `${entityKey.replace(/_/g," ").replace(/(^\w{1})|(\s+\w{1})/g, letter => letter.toUpperCase())}` },
                ...entity.hasOwnProperty('isMainEntity') || entity.hasOwnProperty('unique_id')
                    ? { unique_id: entity.hasOwnProperty('unique_id') ? entity.unique_id : `${this.deviceId}` }
                    : { unique_id: `${this.deviceId}_${entityKey}`},
                ...!entity.component.match(/^(camera|climate|button)$/)
                    ? { state_topic: entityStateTopic }
                    : entity.component === 'climate'
                        ? { mode_state_topic: entityStateTopic }
                        : entity.component === 'camera'
                            ? { topic: entityStateTopic }
                            : {},
                ...entity.component.match(/^(switch|number|light|fan|lock|alarm_control_panel|select|button|valve)$/)
                    ? { command_topic: `${entityTopic}/command` }
                    : {},
                ...entity.hasOwnProperty('device_class')
                    ? { device_class: entity.device_class }
                    : {},
                ...entity.hasOwnProperty('unit_of_measurement')
                    ? { unit_of_measurement: entity.unit_of_measurement }
                    : {},
                ...entity.hasOwnProperty('state_class')
                    ? { state_class: entity.state_class }
                    : {},
                ...entity.hasOwnProperty('value_template')
                    ? { value_template: entity.value_template }
                    : {},
                ...entity.hasOwnProperty('min')
                    ? { min: entity.min }
                    : {},
                ...entity.hasOwnProperty('max')
                    ? { max: entity.max }
                    : {},
                ...entity.hasOwnProperty('mode')
                    ? { mode: entity.mode }
                    : {},
                ...entity.hasOwnProperty('category')
                    ? { entity_category: entity.category }
                    : {},
                ...entity.hasOwnProperty('attributes')
                    ? { json_attributes_topic: `${entityTopic}/attributes` }
                    : entityKey === "info"
                        ? { json_attributes_topic: `${entityStateTopic}` }
                        : {},
                ...entity.hasOwnProperty('icon')
                    ? { icon: entity.icon }
                    : entityKey === "info"
                        ? { icon: 'mdi:information-outline' }
                        : {},
                ...entity.component === 'alarm_control_panel'
                    ? { supported_features: ['arm_home', 'arm_away'],
                        code_arm_required: false,
                        code_disarm_required: Boolean(utils.config().disarm_code),
                        ...utils.config().disarm_code
                            ? { code: utils.config().disarm_code.toString() }
                            : {}
                        }
                    : {},
                ...entity.hasOwnProperty('brightness_scale')
                    ? { brightness_state_topic: `${entityTopic}/brightness_state`,
                        brightness_command_topic: `${entityTopic}/brightness_command`,
                        brightness_scale: entity.brightness_scale }
                    : {},
                ...entity.component === 'fan'
                    ? { percentage_state_topic: `${entityTopic}/percent_speed_state`,
                        percentage_command_topic: `${entityTopic}/percent_speed_command`,
                        preset_mode_state_topic: `${entityTopic}/speed_state`,
                        preset_mode_command_topic: `${entityTopic}/speed_command`,
                        preset_modes: [ "low", "medium", "high" ],
                        speed_range_min: 11,
                        speed_range_max: 100 }
                    : {},
                ...entity.component === 'climate'
                    ? { action_topic: `${entityTopic}/action_state`,
                        current_temperature_topic: `${entityTopic}/current_temperature_state`,
                        fan_mode_command_topic: `${entityTopic}/fan_mode_command`,
                        fan_mode_state_topic: `${entityTopic}/fan_mode_state`,
                        fan_modes: entity.fan_modes,
                        max_temp: 37,
                        min_temp: 10,
                        modes: entity.modes,
                        mode_state_topic: `${entityTopic}/mode_state`,
                        mode_command_topic: `${entityTopic}/mode_command`,
                        preset_mode_command_topic: `${entityTopic}/preset_mode_command`,
                        preset_mode_state_topic: `${entityTopic}/preset_mode_state`,
                        preset_modes: ['Auxillary'],
                        temperature_command_topic: `${entityTopic}/temperature_command`,
                        temperature_state_topic: `${entityTopic}/temperature_state`,
                        ...entity.modes.includes('auto')
                            ? { temperature_high_command_topic: `${entityTopic}/temperature_high_command`,
                                temperature_high_state_topic: `${entityTopic}/temperature_high_state`,
                                temperature_low_command_topic: `${entityTopic}/temperature_low_command`,
                                temperature_low_state_topic: `${entityTopic}/temperature_low_state`,
                            } : {},
                        temperature_unit: 'C' }
                    : {},
                ...entity.component === 'select'
                    ? { options: entity.options }
                    : {},
                availability_topic: this.availabilityTopic,
                payload_available: 'online',
                payload_not_available: 'offline',
                device: this.deviceData
            }

            const configTopic = `homeassistant/${entity.component}/${this.locationId}/${this.deviceId}_${entityKey}/config`
            this.debug(`HASS config topic: ${configTopic}`, 'disc')
            this.debug(discoveryMessage, 'disc')
            this.mqttPublish(configTopic, JSON.stringify(discoveryMessage), false)

            // On first publish store generated topics in entities object and subscribe to command/debug topics
            if (!this.entity[entityKey].hasOwnProperty('published')) {
                this.entity[entityKey].published = true
                Object.keys(discoveryMessage).filter(property => property.match('topic')).forEach(topic => {
                    this.entity[entityKey][topic] = discoveryMessage[topic]
                    if (topic.match('command_topic')) {
                        utils.event.emit('mqtt_subscribe', discoveryMessage[topic])
                        utils.event.on(discoveryMessage[topic], (command, message) => {
                            if (message) {
                                this.processCommand(command, message)
                            } else {
                                this.debug(`Received invalid or null value to command topic ${command}`)
                            }
                        })

                        // Entity uses internal MQTT broker for inter-process communications
                        if (this.entity[entityKey]?.ipc) {
                            const debugTopic = discoveryMessage[topic].split('/').slice(0,-1).join('/')+'/debug'
                            utils.event.emit('mqtt_ipc_subscribe', discoveryMessage[topic])
                            utils.event.emit('mqtt_ipc_subscribe', debugTopic)
                            utils.event.on(debugTopic, (command, message) => {
                                if (message) {
                                    this.debug(message, 'rtsp')
                                } else {
                                    this.debug(`Received invalid or null value to debug log topic ${command}`)
                                }
                            })
                        }
                    }
                })
            }
        })
    }

    // Refresh device info attributes on a sechedule
    async schedulePublishAttributes() {
        while (true) {
            await utils.sleep(this.availabilityState === 'offline' ? 60 : 300)
            if (this.availabilityState === 'online') {
                this.publishAttributes()
            }
        }
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
                    this.mqttPublish(this.entity[entityKey].json_attributes_topic, JSON.stringify(entityAttributes), 'attr')
                }
            }
        })
    }

    // Publish state messages with debug
    mqttPublish(topic, message, debugType, maskedMessage) {
        if (debugType !== false) {
            this.debug(chalk.blue(`${topic} `)+chalk.cyan(`${maskedMessage ? maskedMessage : message}`), debugType)
        }
        utils.event.emit('mqtt_publish', topic, message)
    }

    // Gets all saved state data for device
    getSavedState() {
        return state.getDeviceSavedState(this.deviceId)
    }

    // Called to update saved state data for device
    setSavedState(stateData) {
        state.setDeviceSavedState(this.deviceId, stateData)
    }

    async getUserInfo(userId) {
        const response = await this.device.location.restClient.request({
            url: `https://app.ring.com/api/v1/rs/users/summaries?locationId=${this.locationId}`,
            method: 'POST',
            json: [userId]
        })
        return (Array.isArray(response) && response.length > 0) ? response[0] : false
    }

    // Set state topic online
    async online() {
        if (this.shutdown) { return } // Supress any delayed online state messages if ring-mqtt is shutting down
        const debugType = (this.availabilityState === 'online') ? false : 'mqtt'
        this.availabilityState = 'online'
        this.mqttPublish(this.availabilityTopic, this.availabilityState, debugType)
        await utils.sleep(2)
    }

    // Set state topic offline
    offline() {
        const debugType = (this.availabilityState === 'offline') ? false : 'mqtt'
        this.availabilityState = 'offline'
        this.mqttPublish(this.availabilityTopic, this.availabilityState, debugType)
    }
}
