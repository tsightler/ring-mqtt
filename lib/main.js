import './processhandlers.js'
import './mqtt.js'
import state from './state.js'
import ring from './ring.js'
import utils from './utils.js'
import webui from './webui.js'
import chalk from 'chalk'
import isOnline from 'is-online'
import debugModule from 'debug'

const debug = debugModule('ring-mqtt')

export default new class Main {
    constructor() {
        console.warn = (message) => {
            const suppressedMessages = [
                /^Retry\.\.\./,
                /PHONE_REGISTRATION_ERROR/,
                /Message dropped as it could not be decrypted:/
            ]

            if (!suppressedMessages.some(suppressedMessages => suppressedMessages.test(message))) {
                console.error(message)
            }
        }

        utils.event.on('generated_token', (generatedToken) => {
            this.init(generatedToken)
        })

        this.init()
    }

    async init(generatedToken) {
        if (!state.valid) {
            await state.init()
        }

        const hasToken = state.data.ring_token || generatedToken
        if (!hasToken) {
            this.handleNoToken()
            return
        }

        await this.waitForNetwork()
        await this.attemptRingConnection(generatedToken)
    }

    async waitForNetwork() {
        while (!(await isOnline())) {
            debug(chalk.yellow('Network is offline, waiting 10 seconds to check again...'))
            await utils.sleep(10)
        }
    }

    async attemptRingConnection(generatedToken) {
        if (!await ring.init(state, generatedToken)) {
            debug(chalk.red('Failed to connect to Ring API using saved token, generate a new token using the Web UI'))
            debug(chalk.red('or wait 60 seconds to automatically retry authentication using the existing token'))
            webui.start(state.data.systemId)
            await utils.sleep(60)

            if (!ring.client) {
                debug(chalk.yellow('Retrying authentication with existing saved token...'))
                this.init()
            }
        }
    }

    handleNoToken() {
        if (process.env.RUNMODE === 'addon') {
            debug(chalk.red('No refresh token was found in state file, generate a token using the addon Web UI'))
        } else {
            webui.start(state.data.systemId)
            debug(chalk.red('No refresh token was found in the state file, use the Web UI at http://<host_ip_address>:55123/ to generate a token.'))
        }
    }
}