class Utils
{

    // Simple sleep function for various required delays
    sleep(sec) {
        return new Promise(res => setTimeout(res, sec*1000))
    }

    // Check if devices list from location has an alarm panel (could be only camera/lights)
    hasAlarm(devices) {
        return (devices.filter(device => device.data.deviceType === 'security-panel') ? true : false)
    }

}

module.exports = new Utils()
