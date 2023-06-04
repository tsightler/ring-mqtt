import exithandler from './exithandler.js'
import mqtt from './mqtt.js'
import state from './state.js'
import ring from './ring.js'
import utils from './utils.js'
import tokenApp from './tokenapp.js'
import chalk from 'chalk'
import isOnline from 'is-online'
import debugModule from 'debug'
const debug = debugModule('ring-mqtt')

export default new class Main {
    constructor() {
        // Hack to suppress spurious message from push-receiver during startup
        console.warn = (data) => {
            if (data.includes('PHONE_REGISTRATION_ERROR') || data.match('^Retry...')) {
                return
            }
            console.error(data)
        };
        
        // Start event listeners
        utils.event.on('generated_token', (generatedToken) => {
            this.init(generatedToken)
        })

        this.init()
    }

    async init(generatedToken) {
        if (!state.valid) {
            await state.init()
            tokenApp.setSystemId(state.data.systemId)
        }
            
        // Is there any usable token?
        if (state.data.ring_token || generatedToken) {
            // Wait for the network to be online and then attempt to connect to the Ring API using the token
            while (!(await isOnline())) {
                debug(chalk.yellow('Network is offline, waiting 10 seconds to check again...'))
                await utils.sleep(10)
            }

            if (!await ring.init(state, generatedToken)) {
                debug(chalk.red('Failed to connect to Ring API using saved token, generate a new token using the Web UI'))
                debug(chalk.red('or wait 60 seconds to automatically retry authentication using the existing token'))
                tokenApp.start()
                await utils.sleep(60)
                if (!ring.client) {
                    debug(chalk.yellow('Retrying authentication with existing saved token...'))
                    this.init()
                }
            }
        } else {
            if (process.env.RUNMODE === 'addon') {
                debug(chalk.red('No refresh token was found in state file, generate a token using the addon Web UI'))
            } else {
                tokenApp.start()
                debug(chalk.red('No refresh token was found in the state file, use the Web UI at http://<host_ip_address>:55123/ to generate a token.'))
            }
        }
    }
}
