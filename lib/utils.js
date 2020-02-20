const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const RingApi = require ('ring-client-api').RingApi
const mqttApi = require ('mqtt')

class Utils
{

    // Simple sleep function for various required delays
    sleep(sec) {
        return new Promise(res => setTimeout(res, sec*1000))
    }

    // Check if location has alarm panel (could be only camera/lights)
    hasAlarm(devices) {
        if (devices.filter(device => device.data.deviceType === 'security-panel')) {
            return true
        }
        return false
    }

}

module.exports = new Utils()
