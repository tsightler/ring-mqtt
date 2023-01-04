import config from './config.js'
import dns from 'dns'
import os from 'os'
import fs from 'fs'
import { promisify } from 'util'
import { execSync } from 'child_process'
import { EventEmitter } from 'events'
import debugModule from 'debug'
const debug = {
    mqtt: debugModule('ring-mqtt'),
    attr: debugModule('ring-attr'),
    disc: debugModule('ring-disc'),
    rtsp: debugModule('ring-rtsp')
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
        if (process.env.HAIPADDRESS) {
            return process.env.HAIPADDRESS
        } else {
            try {
                const pLookup = promisify(dns.lookup)
                return (await pLookup(os.hostname())).address
            } catch {
                console.log('Failed to resolve hostname IP address, returning localhost instead')
                return 'localhost'
            }
        }
    }

    getCpuCores() {
        let detectedCores = 0
        // Try to detect the number of physical cores.  This is a slightly different 
        // technique vs what I've seen in other places, which seem to mostly depend 
        // on lscpu, which isn't installed by default on Alpine Linux.  While I could
        // just pull it in for the Docker image, it wasn't clear to me how common it
        // is for lscpu to be installed on other distros so decided to try a different 
        // technique.
        //
        // The code below checks if at least one cpu core_id file exist in sysfs and,
        // if so, reads the core_id value for all cpus, filters to only unique core_ids,
        // and then counts the resulting number of lines.  This works for every system
        // I have access to, Intel, AMD and ARM, and I believe that it is standard
        // enough that it should work in all cases (Linux only)
        if (fs.existsSync('/sys/devices/system/cpu/cpu0/topology/core_id')) {
            detectedCores = parseInt(execSync('cat /sys/devices/system/cpu/cpu[0-9]*/topology/core_id | uniq | wc -l'), 10)
        } else {
            // Fallback will report threads, not just cores
            detectedCores = os.cpus().length
        }
        return detectedCores
    }

    debug(message, debugType) {
        debugType = debugType ? debugType : 'mqtt'
        debug[debugType](message)
    }
}
