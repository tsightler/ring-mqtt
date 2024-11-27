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

class TokenApp {
    constructor() {
        this.app = express()
        this.listener = null
        this.ringConnected = false
        this.systemId = ''
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

    getSystemIdentifier() {
        const prefix = process.env.RUNMODE === 'addon' ? 'ring-mqtt-addon' : 'ring-mqtt'
        return `${prefix}-${this.systemId.slice(-5)}`
    }

    setSystemId(systemId) {
        this.systemId = systemId || this.systemId
    }

    setCookieHeaders(res) {
        res.cookie('systemId', this.getSystemIdentifier(), {
            maxAge: COOKIE_MAX_AGE,
            encode: String,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        })
    }

    async handleAccountSubmission(req, res, restClient) {
        try {
            await restClient.getCurrentAuth()
            if (restClient.using2fa) {
                debug('Username/Password was accepted, waiting for 2FA code to be entered.')
                return res.sendFile('code.html', { root: this.webdir })
            }
        } catch (error) {
            const errorMessage = error.message ||
                'Null response, you may be temporarily throttled/blocked. Please shut down ring-mqtt and try again in a few hours.'
            debug(chalk.red(errorMessage))
            res.cookie('error', errorMessage, { maxAge: 1000, encode: String })
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
            const errorMessage = 'The 2FA code was not accepted, please verify the code and try again.'
            debug(errorMessage)
            res.cookie('error', errorMessage, { maxAge: 1000, encode: String })
            return res.sendFile('code.html', { root: this.webdir })
        }
    }

    setupRoutes() {
        this.app.use(bodyParser.urlencoded({ extended: false }))

        this.app.get(['/', /.*force-token-generation$/], (req, res) => {
            this.setCookieHeaders(res)
            const template = this.ringConnected ? 'connected.html' : 'account.html'
            res.sendFile(template, { root: this.webdir })
        })

        this.app.post(/.*submit-account$/, async (req, res) => {
            this.setCookieHeaders(res)
            const restClient = new RingRestClient({
                email: req.body.email,
                password: req.body.password,
                controlCenterDisplayName: this.getSystemIdentifier(),
                systemId: this.systemId
            })
            await this.handleAccountSubmission(req, res, restClient)
        })

        this.app.post(/.*submit-code$/, async (req, res) => {
            this.setCookieHeaders(res)
            await this.handleCodeSubmission(req, res, restClient)
        })
    }

    async start() {
        if (this.listener) {
            return
        }

        this.setupRoutes()

        this.listener = this.app.listen(PORT, () => {
            debug('Successfully started the token generator web UI')
        })
    }

    async stop() {
        if (this.listener) {
            await this.listener.close()
            this.listener = null
        }
    }
}

export default new TokenApp()