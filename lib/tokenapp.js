const { RingRestClient } = require('../node_modules/@tsightler/ring-client-api/lib/api/rest-client')
const debug = require('debug')('ring-mqtt')
const utils = require('./utils')
const express = require('express')
const bodyParser = require("body-parser")

class TokenApp {
    constructor() {
        this.app = express()
        this.listener = false
        this.ringConnected = false

        if (process.env.RUNMODE === 'addon') {
            this.start()
        }

        utils.event.on('ringState', async (state) => {
            if (state === 'connected') {
                this.ringConnected = true

                // Only the addon leaves the web UI running all the time
                if (process.env.RUNMODE !== 'addon') {
                    this.stop()
                }
            } else {
                this.ringConnected = false
            }
        })
    }

    // Super simple web service to acquire authentication tokens from Ring
    async start() {
        if (this.listener) {
            return
        }
        
        const webdir = __dirname+'/../web'
        let restClient

        this.listener = this.app.listen(55123, () => {
            if (process.env.RUNMODE === 'addon') {
                debug('Open the Web UI from the addon Info tab to generate an authentication token.')
            } else {
                debug('Use the Web UI at http://<host_ip_address>:55123/ to generate an authentication token.')
            }
        })

        this.app.use(bodyParser.urlencoded({ extended: false }))

        this.app.get('/', (req, res) => {
            if (this.ringConnected) {
                res.sendFile('connected.html', {root: webdir})
            } else {
                res.sendFile('account.html', {root: webdir})
            }        
        })

        this.app.get(/.*force-token-generation$/, (req, res) => {
            res.sendFile('account.html', {root: webdir})
        })

        this.app.post(/.*submit-account$/, async (req, res) => {
            const email = req.body.email
            const password = req.body.password
            restClient = await new RingRestClient({ email, password })
            // Check if the user/password was accepted
            try {
                await restClient.getCurrentAuth()
            } catch(error) {
                if (restClient.using2fa) {
                    debug('Username/Password was accepted, waiting for 2FA code to be entered.')
                    res.sendFile('code.html', {root: webdir})
                } else {
                    res.cookie('error', error.message, { maxAge: 1000, encode: String })
                    res.sendFile('account.html', {root: webdir})
                }
            }
        })

        this.app.post(/.*submit-code$/, async (req, res) => {
            let generatedToken
            const code = req.body.code
            try {
                generatedToken = await restClient.getAuth(code)
            } catch(err) {
                generatedToken = false
                const errormsg = 'The 2FA code was not accepted, please verify the code and try again.'
                debug(errormsg)
                res.cookie('error', errormsg, { maxAge: 1000, encode: String })
                res.sendFile('code.html', {root: webdir})
            }
            if (generatedToken) {
                res.sendFile('restart.html', {root: webdir})
                utils.event.emit('generatedToken', generatedToken.refresh_token)
            }
        })
    }

    async stop() {
        if (this.listener) {
            await this.listener.close()
            this.listener = false
        }
    }
}

module.exports = new TokenApp()
