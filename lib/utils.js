const debug = {
    mqtt: require('debug')('ring-mqtt'),
    attr: require('debug')('ring-attr'),
    disc: require('debug')('ring-disc')
}
const config = require('./config')
const dns = require('dns')
const os = require('os')
const { promisify } = require('util')
const EventEmitter = require('events').EventEmitter

class Utils {
    // Define a few helper variables for sharing
    event = new EventEmitter()
    config = config.data

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
        const pLookup = promisify(dns.lookup)
        try {
            return (await pLookup(os.hostname())).address
        } catch {
            console.log('Failed to resolve hostname IP address, returning localhost instead')
            return 'localhost'
        }
    }

    debug(message, debugType) {
        debugType = debugType ? debugType : 'mqtt'
        debug[debugType](message)
    }
}

module.exports = new Utils()
