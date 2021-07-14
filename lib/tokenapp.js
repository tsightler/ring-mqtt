const RingRestClient = require('../node_modules/ring-client-api/lib/api/rest-client').RingRestClient
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const express = require('express')
const bodyParser = require("body-parser")
const utils = require('./utils.js')

class TokenApp {
    constructor() {
        this.app = express()
        this.listener

        // Helper property to pass values between main code and web server
        this.token = {
            connected: '',
            generatedInternal: '',
            generatedListener: function(val) {},
            set generated(val) {
                this.generatedInternal = val;
                this.generatedListener(val);
            },
            get generated() {
                return this.generatedInternal;
            },
            registerListener: function(listener) {
                this.generatedListener = listener;
            }
        }
    }

    updateConnectedToken(token) {
        this.token.connected = token
    }

    // Super simple web service to acquire refresh tokens
    async start() {
        const webdir = __dirname+'/../web'
        let restClient

        this.listener = this.app.listen(55123, () => {
            if (!process.env.HASSADDON) {
                debug('Go to http://<host_ip_address>:55123/ to generate a valid token.')
            }
        })

        this.app.use(bodyParser.urlencoded({ extended: false }))

        this.app.get('/', (req, res) => {
            if (!this.token.connected) {
                res.sendFile('account.html', {root: webdir})
            } else {
                res.sendFile('connected.html', {root: webdir})
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
                    debug(error.message)
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
            } catch(_) {
                generatedToken = ''
                const errormsg = 'The 2FA code was not accepted, please verify the code and try again.'
                debug(errormsg)
                res.cookie('error', errormsg, { maxAge: 1000, encode: String })
                res.sendFile('code.html', {root: webdir})
            }
            if (generatedToken) {
                if (process.env.HASSADDON) {
                    res.sendFile('restart.html', {root: webdir})
                    this.token.generated = generatedToken.refresh_token
                } else {
                    res.cookie('token', generatedToken.refresh_token, { maxAge: 1000, encode: String })
                    res.sendFile('token.html', {root: webdir})
                    await utils.sleep(2)
                    process.exit(0)
                }
            }
        })
    }
}

module.exports = new TokenApp()
