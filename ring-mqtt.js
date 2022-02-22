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

    if (config.runMode === 'addon') {
        tokenApp.start(config.runMode)
    }

    // If refresh token was generated via web UI, use it, otherwise attempt to get latest token from state file
    if (generatedToken) {
        debug(state.valid ? 'Updating state data with token generated via web UI.' : 'Using refresh token generated via web UI.')
        state.data.ring_token = generatedToken
    }
    
    // If no refresh tokens were found, either exit or start Web UI for token generator
    if (!state.data.ring_token) {
        if (config.runMode === 'docker') {
            debug(colors.brightRed('No refresh token was found in state file, generate a token using get-ring-token.js.'))
            process.exit(2)
        } else {
            debug(colors.brightRed('No refresh token was found in state file, generate a token using the Web UI.'))
            if (config.runMode === 'standard') {
                tokenApp.start(config.runMode)
            }
        }
    } else {
        // There is either web UI generated or saved state refresh token available
        // Wait for the network to be online and then attempt to connect to the Ring API using the token
        while (!(await isOnline())) {
            debug(colors.brightYellow('Network is offline, waiting 10 seconds to check again...'))
            await utils.sleep(10)
        }

        const ringAuth = {
            refreshToken: state.data.ring_token,
            systemId: state.data.systemId,
            controlCenterDisplayName: (config.runMode === 'addon') ? 'ring-mqtt-addon' : 'ring-mqtt',
            ...config.data.enable_cameras ? { cameraStatusPollingSeconds: 20, cameraDingsPollingSeconds: 2 } : {},
            ...config.data.enable_modes ? { locationModePollingSeconds: 20 } : {},
            ...!(config.data.location_ids === undefined || config.data.location_ids == 0) ? { locationIds: config.data.location_ids } : {}
        }

        if (await ring.init(ringAuth, config.data, generatedToken ? 'generated' : 'saved')) {
            debug('Successfully established connection to Ring API')

            // Update the web app with current connected refresh token
            const currentAuth = await ring.client.restClient.authPromise
            tokenApp.updateConnectedToken(currentAuth.refresh_token)

            // Subscribed to token update events and save new token
            ring.client.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
                state.updateToken(newRefreshToken, oldRefreshToken)
            })

            mqtt.init(ring, config.data)
        } else {
            debug(colors.brightRed('Failed to connect to Ring API using the refresh token in the saved state file.'))
            if (config.runMode === 'docker') {
                debug(colors.brightRed('Restart the container to try again or generate a new token using get-ring-token.js.'))
                process.exit(2)
            } else {
                debug(colors.brightRed(`Restart the ${this.runMode === 'addon' ? 'addon' : 'script'} or generate a new token using the Web UI.`))
                if (config.runMode === 'standard') {
                    tokenApp.start(config.runMode)
                }
            }
        }
    }
}

// Subscribe to token updates from token Web UI
tokenApp.token.registerListener(function(generatedToken) {
    main(generatedToken)
})

main()