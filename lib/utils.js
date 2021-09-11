const fs = require('fs')
const dns = require('dns')
const os = require('os')
const { promisify } = require('util')

class Utils
{
    // Sleep function (seconds)
    sleep(sec) {
        return this.msleep(sec*1000)
    }

    // Sleep function (milliseconds)
    msleep(msec) {
        return new Promise(res => setTimeout(res, msec))
    }

    // Function to check if file exist and, optionally, if it is over a given size  
    checkFile(file, sizeInBytes) {
        sizeInBytes = sizeInBytes ? sizeInBytes : 0 
        if (!fs.existsSync(file)) {
            return false
        } else if (fs.statSync(file).size > sizeInBytes) {
            return true
        } else {
            return false           
        }
    }

    // Return ISO time from epoch without milliseconds
    getISOTime(epoch) {
        return new Date(epoch).toISOString().slice(0,-5)+"Z"
    }

    async getHostFqdn() {
        const pLookupService = promisify(dns.lookupService)
        try {
            return await (pLookupService(await this.getHostIp(), 0)).hostname
        } catch {
            console.log('Failed to resolve FQDN, using os.hostname() instead')
            return os.hostname()
        }
    }

    async getHostIp() {
        const pLookup = promisify(dns.lookup)
        try {
            return await (pLookup(os.hostname())).address
        } catch {
            console.log('Failed to resolve hostname IP address, returning localhost instead')
            return 'localhost'
        }
    }
}

module.exports = new Utils()
