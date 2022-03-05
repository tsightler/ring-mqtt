#!/usr/bin/env node
const exitHandler = require('./lib/exithandler')
const config = require('./lib/config')
const state = require('./lib/state')
const ring = require('./lib/ring')
const isOnline = require('is-online')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./lib/utils')
const tokenApp = require('./lib/tokenapp')

// Main code loop
const main = async(generatedToken) => {
    if (!state.valid) {
        await exitHandler.init()
        await state.init(config)
    }
        
    // Is there any usable token?
    if (state.data.ring_token || generatedToken) {
        // Wait for the network to be online and then attempt to connect to the Ring API using the token
        while (!(await isOnline())) {
            debug(colors.brightYellow('Network is offline, waiting 10 seconds to check again...'))
            await utils.sleep(10)
        }

        if (!await ring.init(state, generatedToken)) {
            debug(colors.brightRed('Failed to connect to Ring API using saved token, generate a new token using the Web UI'))
            debug(colors.brightRed('or wait 60 seconds to automatically retry authentication using the existing token'))
            tokenApp.start()
            await utils.sleep(60)
            main()
        }
    } else {
        // If a refresh token was not found, start Web UI for token generator
        debug(colors.brightRed('No refresh token was found in state file, generate a token using the Web UI'))
        tokenApp.start()
    }
}

// Listen for token updates from token Web UI
utils.event.on('generatedToken', (generatedToken) => {
    main(generatedToken)
})

main()