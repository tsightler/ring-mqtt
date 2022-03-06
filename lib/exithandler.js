const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils')
const ring = require('./ring')

class ExitHandler {
    constructor() {
        this.init()
    }

    init() {
        // Setup Exit Handlers
        process.on('exit', this.processExit.bind(null, 0))
        process.on('SIGINT', this.processExit.bind(null, 0))
        process.on('SIGTERM', this.processExit.bind(null, 0))
        process.on('uncaughtException', (err) => {
            debug(colors.red('ERROR - Uncaught Exception'))
            console.log(colors.red(err))
            processExit(2)
        })
        process.on('unhandledRejection', (err) => {
            switch(true) {
                // For these strings suppress the stack trace and only print the message
                case /token is not valid/.test(err.message):
                case /https:\/\/github.com\/dgreif\/ring\/wiki\/Refresh-Tokens/.test(err.message):
                case /error: access_denied/.test(err.message):
                    debug(colors.yellow(err.message))
                    break;
                default:
                    debug(colors.yellow('WARNING - Unhandled Promise Rejection'))
                    console.log(colors.yellow(err))
                    break;
            }
        })
    }

    // Set offline status on exit
    async processExit(exitCode) {
        await utils.sleep(1)
        debug('The ring-mqtt process is shutting down...')
        await ring.rssShutdown()
        if (ring.devices.length > 0) {
            debug('Setting all devices offline...')
            await utils.sleep(1)
            ring.devices.forEach(ringDevice => {
                if (ringDevice.availabilityState === 'online') { 
                    ringDevice.shutdown = true
                    ringDevice.offline() 
                }
            })
        }
        await utils.sleep(2)
        if (exitCode || exitCode === 0) debug(`Exit code: ${exitCode}`);
        process.exit()
    }
}

module.exports = new ExitHandler()