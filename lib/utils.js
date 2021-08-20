const fs = require('fs')

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
}

module.exports = new Utils()
