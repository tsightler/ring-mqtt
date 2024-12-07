import { RingRestClient } from 'ring-client-api/rest-client'
import utils from './utils.js'
import express from 'express'
import bodyParser from 'body-parser'
import chalk from 'chalk'
import debugModule from 'debug'
import { webTemplate } from './web-template.js'

const debug = debugModule('ring-mqtt')

class WebService {
    constructor() {
        this.app = express()
        this.listener = null
        this.ringConnected = false
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
            res.json({ success: true })
        } catch (error) {
            if (restClient.using2fa) {
                debug('Username/Password was accepted, waiting for 2FA code to be entered.')
                res.json({ requires2fa: true })
            } else {
                const errorMessage = error.message || 'Null response, you may be temporarily throttled/blocked. Please shut down ring-mqtt and try again in a few hours.'
                debug(chalk.red(errorMessage))
                res.status(400).json({ error: errorMessage })
            }
        }
    }

    async handleCodeSubmission(req, res, restClient) {
        try {
            const generatedToken = await restClient.getAuth(req.body.code)
            if (generatedToken) {
                utils.event.emit('generated_token', generatedToken.refresh_token)
                res.json({ success: true })
            }
        } catch (error) {
            const errorMessage = error.message || 'The 2FA code was not accepted, please verify the code and try again.'
            debug(chalk.red(errorMessage))
            res.status(400).json({ error: errorMessage })
        }
    }

    setupRoutes() {
        let restClient
        this.app.use(bodyParser.urlencoded({ extended: false }))
        this.app.use(bodyParser.json())

        const router = express.Router()

        router.get('/get-state', (req, res) => {
            res.json({
                connected: this.ringConnected,
                displayName: this.displayName
            })
        })

        router.post('/submit-account', async (req, res) => {
            restClient = new RingRestClient({
                email: req.body.email,
                password: req.body.password,
                controlCenterDisplayName: this.displayName,
                systemId: this.systemId
            })
            await this.handleAccountSubmission(req, res, restClient)
        })

        router.post('/submit-code', async (req, res) => {
            await this.handleCodeSubmission(req, res, restClient)
        })

        // Mount router at base URL
        this.app.use('/', router)

        // Serve the static HTML
        this.app.get('*', (req, res) => {
            res.send(webTemplate)
        })
    }

    async start(systemId) {
        if (this.listener) {
            return
        }

        this.systemId = systemId
        this.displayName = `${process.env.RUNMODE === 'addon' ? 'ring-mqtt-addon' : 'ring-mqtt'}-${systemId.slice(-5)}`

        this.setupRoutes()

        this.listener = this.app.listen(55123, () => {
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

export default new WebService()