#!/usr/bin/env node

const config = require('./lib/config')
const state = require('./lib/state')
const ring = require('./lib/ring')
const mqtt = require('./lib/mqtt')
const isOnline = require('is-online')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./lib/utils.js')
const tokenApp = require('./lib/tokenapp.js')

// Setup Exit Handlers
process.on('exit', processExit.bind(null, 0))
process.on('SIGINT', processExit.bind(null, 0))
process.on('SIGTERM', processExit.bind(null, 0))
process.on('uncaughtException', function(err) {
    debug(colors.red('ERROR - Uncaught Exception'))
    console.log(colors.red(err))
    processExit(2)
})
process.on('unhandledRejection', function(err) {
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

// Set offline status on exit
async function processExit(exitCode) {
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
 
/* End Functions */

// Main code loop
const main = async(generatedToken) => {
    if (!state.valid) { 
        await state.init(config)
    }
        
    // Is there any usable token?
    if (state.data.ring_token || generatedToken) {
        // Wait for the network to be online and then attempt to connect to the Ring API using the token
        while (!(await isOnline())) {
            debug(colors.brightYellow('Network is offline, waiting 10 seconds to check again...'))
            await utils.sleep(10)
        }

        const ringAuth = {
            refreshToken: generatedToken ? generatedToken : state.data.ring_token,
            systemId: state.data.systemId,
            controlCenterDisplayName: (config.runMode === 'addon') ? 'ring-mqtt-addon' : 'ring-mqtt',
            ...config.data.enable_cameras ? { cameraStatusPollingSeconds: 20, cameraDingsPollingSeconds: 2 } : {},
            ...config.data.enable_modes ? { locationModePollingSeconds: 20 } : {},
            ...!(config.data.location_ids === undefined || config.data.location_ids == 0) ? { locationIds: config.data.location_ids } : {}
        }

        const tokenSource = generatedToken ? 'generated' : 'saved'
        if (await ring.init(ringAuth, config.data, tokenSource)) {
            debug(`Successfully established connection to Ring API using ${tokenSource} token`)

            // Subscribe to token update events and save new tokens to state file
            ring.client.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
                state.updateToken(newRefreshToken, oldRefreshToken)
            })

            // Only leave the web UI active if this is the addon
            if (config.runMode !== 'addon') {
                tokenApp.stop()
            }

            // Connection to Ring API is successful, attempt to connect to MQTT and start publishing
            mqtt.init(ring, config.data)
        } else {
            debug(colors.brightRed('Failed to connect to Ring API using saved token, generate a new token using the Web UI.'))
            debug(colors.brightRed('Authentication will be automatically retried in 60 seconds using the existing token.'))
            tokenApp.start(config.runMode)
            await utils.sleep(60)
            main()
        }
    } else {
        // If a refresh token was not found, start Web UI for token generator
        debug(colors.brightRed('No refresh token was found in state file, generate a token using the Web UI.'))
        tokenApp.start(config.runMode)
    }
}

if (config.runMode === 'addon') {
    tokenApp.start(config.runMode)
}

// Subscribe to token updates from token Web UI
tokenApp.token.registerListener(function(generatedToken) {
    main(generatedToken)
})

main()