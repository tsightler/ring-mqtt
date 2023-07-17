import config from './config.js'
import dns from 'dns'
import os from 'os'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import debugModule from 'debug'
const debug = {
    mqtt: debugModule('ring-mqtt'),
    attr: debugModule('ring-attr'),
    disc: debugModule('ring-disc'),
    rtsp: debugModule('ring-rtsp'),
    wrtc: debugModule('ring-wrtc')
}

export default new class Utils {

    constructor() {
        this.event = new EventEmitter()
    }

    config() {
        return config.data
    }

    // Sleep function (seconds)
    sleep(sec) {
        return this.msleep(sec*1000)
    }

    // Sleep function (milliseconds)
    msleep(msec) {
        return new Promise(res => setTimeout(res, msec))
    }

    // Return ISO time from epoch without milliseconds
    getISOTime(epoch) {
        return new Date(epoch).toISOString().slice(0,-5)+"Z"
    }

    async getHostFqdn() {
        const pLookupService = promisify(dns.lookupService)
        try {
            return (await pLookupService(await this.getHostIp(), 0)).hostname
        } catch {
            console.log('Failed to resolve FQDN, using os.hostname() instead')
            return os.hostname()
        }
    }

    async getHostIp() {
        try {
            const pLookup = promisify(dns.lookup)
            return (await pLookup(os.hostname())).address
        } catch {
            console.log('Failed to resolve hostname IP address, returning localhost instead')
            return 'localhost'
        }
    }

    isNumeric(num) {
        return !isNaN(parseFloat(num)) && isFinite(num);
    }

    debug(message, debugType) {
        debugType = debugType ? debugType : 'mqtt'
        debug[debugType](message)
    }
}
