import { RingRestClient } from 'ring-client-api/rest-client'
import utils from './utils.js'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import bodyParser from 'body-parser'
import chalk from 'chalk'
import debugModule from 'debug'

const PORT = 55123
const COOKIE_MAX_AGE = 3600000
const debug = debugModule('ring-mqtt')

class WebUI {
    constructor() {
        this.app = express()
        this.listener = null
        this.ringConnected = false
        this.webdir = dirname(fileURLToPath(new URL('.', import.meta.url))) + '/web'

        if (process.env.RUNMODE === 'addon') {
            this.start()
        }

        this.initializeEventListeners()
    }

    initializeEventListeners() {
        utils.event.on('ring_api_state', async (state) => {
            this.ringConnected = state === 'connected'

            if (this.ringConnected && process.env.RUNMODE !== 'addon') {
                await this.stop()
            }
        })
    }

    async handleAccountSubmission(req, res, restClient) {
        try {
            await restClient.getCurrentAuth()
        } catch (error) {
            if (restClient.using2fa) {
                debug('Username/Password was accepted, waiting for 2FA code to be entered.')
                return res.sendFile('code.html', { root: this.webdir })
            }
            const errorMessage = error.message ||  'Null response, you may be temporarily throttled/blocked. Please shut down ring-mqtt and try again in a few hours.'
            debug(chalk.red(errorMessage))
            res.cookie('error', errorMessage, { maxAge: 1000 })
            return res.sendFile('account.html', { root: this.webdir })
        }
    }

    async handleCodeSubmission(req, res, restClient) {
        try {
            const generatedToken = await restClient.getAuth(req.body.code)
            if (generatedToken) {
                utils.event.emit('generated_token', generatedToken.refresh_token)
                return res.sendFile('restart.html', { root: this.webdir })
            }
        } catch (error) {
            const errorMessage = error.message || 'The 2FA code was not accepted, please verify the code and try again.'
            debug(chalk.red(errorMessage))
            res.cookie('error', errorMessage, { maxAge: 1000 })
            return res.sendFile('code.html', { root: this.webdir })
        }
    }

    setupRoutes() {
        this.app.use(bodyParser.urlencoded({ extended: false }))

        this.app.get(['/', /.*force-token-generation$/], (req, res) => {
            res.cookie('displayName', this.displayName, { maxAge: COOKIE_MAX_AGE })
            const template = this.ringConnected ? 'connected.html' : 'account.html'
            res.sendFile(template, { root: this.webdir })
        })

        let restClient
        this.app.post(/.*submit-account$/, async (req, res) => {
            res.cookie('displayName', this.displayName, { maxAge: COOKIE_MAX_AGE })
            restClient = new RingRestClient({
                email: req.body.email,
                password: req.body.password,
                controlCenterDisplayName: this.displayName,
                systemId: this.systemId
            })
            await this.handleAccountSubmission(req, res, restClient)
        })

        this.app.post(/.*submit-code$/, async (req, res) => {
            res.cookie('displayName', this.displayName, { maxAge: COOKIE_MAX_AGE })
            await this.handleCodeSubmission(req, res, restClient)
        })
    }

    async start(systemId) {
        if (this.listener) {
            return
        }

        this.systemId = systemId
        this.displayName = `${process.env.RUNMODE === 'addon' ? 'ring-mqtt-addon' : 'ring-mqtt'}-${systemId.slice(-5)}`

        this.setupRoutes()

        this.listener = this.app.listen(PORT, () => {
            debug('Successfully started the ring-mqtt web UI')
        })
    }

    async stop() {
        if (this.listener) {
            await this.listener.close()
            this.listener = null
        }
    }
}

export default new WebUI()