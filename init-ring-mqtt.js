#!/usr/bin/env node
const fs = require('fs')
const writeFileAtomic = require('write-file-atomic')
const { createHash, randomBytes } = require('crypto')
const { RingRestClient } = require('./node_modules/ring-client-api/lib/api/rest-client')
const { requestInput } = require('./node_modules/ring-client-api/lib/api/util')

async function getRefreshToken() {
    let generatedToken
    const email = await requestInput('Email: ')
    const password = await requestInput('Password: ')
    const restClient = new RingRestClient({ email, password })
    try {
        await restClient.getCurrentAuth()
    } catch(err) {
        if (restClient.using2fa) {
            console.log('Username/Password was accepted, waiting for 2FA code to be entered.')
        } else {
            throw(err.message)
        }
    }

    while(!generatedToken) { 
        const code = await requestInput('2FA Code: ')
        try {
            generatedToken = await restClient.getAuth(code)
            return generatedToken.refresh_token
        } catch(err) {
            throw('Failed to validate the entered 2FA code. (error: invalid_code)')
        }
    }
}

const main = async() => {
    let refresh_token
    let stateData = {}
    // If running in Docker set state file path as appropriate
    const stateFile = (fs.existsSync('/etc/cont-init.d/ring-mqtt.sh')) 
        ? '/data/ring-state.json'
        : require('path').dirname(require.main.filename)+'/ring-state.json'
    
    const configFile = (fs.existsSync('/etc/cont-init.d/ring-mqtt.sh')) 
        ? '/data/config.json'
        : require('path').dirname(require.main.filename)+'/config.json'

    if (fs.existsSync(stateFile)) {
        console.log('Reading latest data from state file: '+stateFile)
        try {
            stateData = require(stateFile)
        } catch(err) {
            console.log(err.message)
            console.log('Saved state file '+stateFile+' exist but could not be parsed!')
            console.log('To create new state file please rename/delete existing file and re-run this tool.')
            process.exit(1)
        }
    }

    try {
        refresh_token = await getRefreshToken()
    } catch(err) {
        console.log(err)
        console.log('Please re-run this tool to retry authentication.')
        process.exit(1)
    }

    stateData.ring_token = refresh_token
    if (!stateData.hasOwnProperty('systemId') || (stateData.hasOwnProperty('systemId') && !stateData.systemId)) {
        stateData.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
    }
    try {
        await writeFileAtomic(stateFile, JSON.stringify(stateData))
        console.log('State file ' +stateFile+ ' saved with updated refresh token.')
    } catch (err) {
        console.log('Saving state file '+stateFile+' failed with error: ')
        console.log(err)
    }

    const configData = {
        "mqtt_url": "mqtt://localhost:1883",
        "mqtt_options": "",
        "livestream_user": "",
        "livestream_pass": "",
        "disarm_code": "",
        "enable_cameras": true,
        "enable_modes": false,
        "enable_panic": false,
        "hass_topic": "homeassistant/status",
        "ring_topic": "ring",
        "location_ids": [
            ""
        ]
    }

    if (!fs.existsSync(configFile)) {
        try {
            await writeFileAtomic(configFile, JSON.stringify(configData, null, 4))
            console.log('New config file written to '+configFile)
        } catch (err) {
            console.log('Failed to create new config file at '+stateFile)
            conslog.log(err)
        }
    }
}

main()