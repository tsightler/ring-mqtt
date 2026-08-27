import RingDevice from './base-ring-device.js'
import utils from '../lib/utils.js'

// Base class for devices/features that communicate via HTTP polling interface (cameras/chime/modes)
export default class RingPolledDevice extends RingDevice {
    constructor(deviceInfo, category, primaryAttribute) {
        super(deviceInfo, category, primaryAttribute, 'polled')
        this.heartbeat = 3

        // Sevice data for Home Assistant device registry
        this.deviceData = {
            ids: [ this.deviceId ],
            name: this.device.name,
            mf: 'Ring',
            mdl: this.device.model
        }

        this.device.onData.subscribe((data) => {
            // Reset heartbeat counter on every polled state
            this.heartbeat = 3
            if (this.discoveryPublished && this.isOnline()) { this.publishState(data) }
        })

        this.monitorHeartbeat()
    }

    // Publish device discovery, set online, and send all state data
    async publish() {
        await this.publishDiscovery()
        // Sleep for a few seconds to give HA time to process discovery message
        await utils.sleep(2)
        await this.online()
        this.publishState()
    }

    // This is a simple heartbeat function for devices which use polling.  This
    // function decrements the heartbeat counter every 20 seconds.  In normal operation
    // the heartbeat is constantly reset in the data publish function due to data
    // polling events however, if something interrupts the connection, polling stops
    // and this function will decrement until the heartbeat reaches zero.  In this case
    // this function sets the device status offline.  When polling resumes the heartbeat
    // is set > 0 and this function will set the device back online after a short delay.
    async monitorHeartbeat() {
        // A device which has never been published has no entity topics yet so it must not be
        // brought online here, only publish() can make that initial transition.  Devices still
        // in the 'unpublished' state simply idle until that happens.
        if (this.availabilityState !== 'unpublished') {
            if (this.heartbeat > 0) {
                if (this.availabilityState === 'offline') {
                    // If device was offline wait 10 seconds and check again, if still
                    // offline put the device back online.
                    await utils.sleep(10)
                    if (this.heartbeat > 0 && this.availabilityState === 'offline') {
                        await this.online()
                    }
                }
                this.heartbeat--
            } else if (this.availabilityState !== 'offline') {
                this.offline()
            }
        }
        await utils.sleep(20)
        this.monitorHeartbeat()
    }

    // Device health is only used for optional attributes/entities so a failed
    // query should never keep the device itself from being published
    async getHealth() {
        try {
            return await this.device.getHealth()
        } catch (err) {
            this.debug(err)
            this.debug('Failed to retrieve device health data from Ring API')
        }
    }

    async getDeviceHistory(options) {
        try {
            const response = await this.device.restClient.request({
                method: 'GET',
                url: `https://api.ring.com/evm/v2/history/devices/${this.device.id}${this.getSearchQueryString({
                    capabilities: 'offline_event',
                    ...options,
                })}`
            })
            return response
        } catch (err) {
            this.debug(err)
            this.debug('Failed to retrieve device event history from Ring API')
        }
    }

    getSearchQueryString(options) {
        const queryString = Object.entries(options)
            .map(([key, value]) => {
            if (value === undefined) {
                return '';
            }
            return `${key}=${value}`;
        })
            .filter((x) => x)
            .join('&');
        return queryString.length ? `?${queryString}` : '';
    }
}
