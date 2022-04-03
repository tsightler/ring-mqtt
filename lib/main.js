require('./exithandler')
require('./mqtt')
const config = require('./config')
const state = require('./state')
const ring = require('./ring')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils')
const tokenApp = require('./tokenapp')
const isOnline = require('is-online')

class Main {
    constructor() {

        // Start event listeners
        utils.event.on('generated_token', (generatedToken) => {
            this.init(generatedToken)
        })

        this.init()
    }

    async init(generatedToken) {
        if (!state.valid) {
            await state.init(config)
        }
            
        // Is there any usable token?
        if (state.data.ring_token || generatedToken) {
            // Wait for the network to be online and then attempt to connect to the Ring API using the token
            while (!(await isOnline())) {
                debug(colors.yellow('Network is offline, waiting 10 seconds to check again...'))
                await utils.sleep(10)
            }

            if (!await ring.init(state, generatedToken)) {
                debug(colors.red('Failed to connect to Ring API using saved token, generate a new token using the Web UI'))
                debug(colors.red('or wait 60 seconds to automatically retry authentication using the existing token'))
                tokenApp.start()
                await utils.sleep(60)
                if (!ring.client) {
                    debug(colors.red('Retrying authentication with existing saved token...'))
                    init()
                }
            }
        } else {
            if (process.env.RUNMODE === 'addon') {
                debug(colors.red('No refresh token was found in state file, generate a token using the addon Web UI'))
            } else {
                tokenApp.start()
                debug(colors.red('No refresh token was found in the state file, use the Web UI at http://<host_ip_address>:55123/ to generate a token.'))
            }
        }
    }
}

module.exports = new Main()