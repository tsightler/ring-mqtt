import config from './config.js'
import dns from 'dns'
import os from 'os'
import { promisify } from 'util'
import { EventEmitter } from 'events'
import debug from 'debug'

const debuggers = {
  mqtt: debug('ring-mqtt'),
  attr: debug('ring-attr'),
  disc: debug('ring-disc'),
  rtsp: debug('ring-rtsp'),
  wrtc: debug('ring-wrtc')
}

class Utils {
  constructor() {
    this.event = new EventEmitter()
    this.dnsLookup = promisify(dns.lookup)
    this.dnsLookupService = promisify(dns.lookupService)
  }

  config() {
    return config.data
  }

  configFile() {
    return process.env.CONFIG_FILE ?? '/data/config.json'
  }

  sleep(sec) {
    return this.msleep(sec * 1000)
  }

  msleep(msec) {
    return new Promise(res => setTimeout(res, msec))
  }

  getISOTime(epoch) {
    return new Date(epoch).toISOString().slice(0, -5) + 'Z'
  }

  async getHostFqdn() {
    try {
      const ip = await this.getHostIp()
      const { hostname } = await this.dnsLookupService(ip, 0)
      return hostname
    } catch (error) {
      console.warn('Failed to resolve FQDN, using os.hostname() instead:', error.message)
      return os.hostname()
    }
  }

  async getHostIp() {
    try {
      const { address } = await this.dnsLookup(os.hostname())
      return address
    } catch (error) {
      console.warn('Failed to resolve hostname IP address, returning localhost instead:', error.message)
      return 'localhost'
    }
  }

  isNumeric(num) {
    return !isNaN(parseFloat(num)) && isFinite(num)
  }

  debug(message, debugType = 'mqtt') {
    debuggers[debugType]?.(message)
  }
}

export default new Utils()