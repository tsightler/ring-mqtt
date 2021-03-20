const fs = require('fs');

class Utils
{

    // Sleep function
    sleep(sec) {
        return new Promise(res => setTimeout(res, sec*1000))
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
}

module.exports = new Utils()
