#!/usr/bin/env node

// Defines
var RingApi = require('ring-client-api').RingApi
const fs = require('fs')
var CONFIG
var ringTopic
var hassTopic
var mqttClient
var mqttConnected = false
var ringLocations = new Array()
var subscribedLocations = new Array()
var subscribedDevices = new Array()
var publishEnabled = true  // Flag to stop publish/republish if connection is down
var republishCount = 10 // Republish config/state this many times after startup or HA start/restart
var republishDelay = 30 // Seconds

const main = async() => {
    let locationIds = null

    // Get Configuration from file
    try {
        CONFIG = require('./config')
        ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
        hassTopic = CONFIG.hass_topic
        if (!(CONFIG.location_ids === undefined || CONFIG.location_ids == 0)) {
            locationIds = CONFIG.location_ids
        }
    } catch (e) {
        try {
            debugError('Configuration file not found, try environment variables!')
            CONFIG = {
                "host": process.env.MQTTHOST,
                "port": process.env.MQTTPORT,
                "ring_topic": process.env.MQTTRINGTOPIC,
                "hass_topic": process.env.MQTTHASSTOPIC,
                "mqtt_user": process.env.MQTTUSER,
                "mqtt_pass": process.env.MQTTPASSWORD,
                "ring_user": process.env.RINGUSER,
                "ring_pass": process.env.RINGPASS,
                "ring_token": process.env.RINGTOKEN,
            }
            ringTopic = CONFIG.ring_topic ? CONFIG.ring_topic : 'ring'
            hassTopic = CONFIG.hass_topic
            if (!(CONFIG.ring_user || CONFIG.ring_pass) && !CONFIG.ring_token) throw "Required environment variables are not set!"
        }
        catch (ex) {
            debugError(ex)
            console.error('Configuration file not found and required environment variables are not set!')
            process.exit(1)
        }
    }

    // Establish connection to Ring API
    try {
        let auth = {
            locationIds: locationIds
        }

        // Ring allows users to enable two-factor authentication. If this is
        // enabled, the user/pass authentication will not work.
        //
        // See: https://github.com/dgreif/ring/wiki/Two-Factor-Auth
        if(CONFIG.ring_token) {
            auth["refreshToken"] = CONFIG.ring_token
        } else {
            auth["email"] = CONFIG.ring_user
            auth["password"] = CONFIG.ring_pass
        }

        const ringApi = new RingApi(auth)
        ringLocations = await ringApi.getLocations()
    } catch (error) {
        debugError(error)
        debugError( colors.red( 'Couldn\'t create the API instance. This could be because ring.com changed their API again' ))
        debugError( colors.red( 'or maybe the password is wrong. Please check settings and try again.' ))
        process.exit(1)
    }
    
    const devices = await ringLocations[0].getDevices()
    let devData = JSON.stringify(devices);
    fs.writeFileSync('devices.txt', devices);
    console.log(devices)
    process.exit(0)
}

// Call the main code
main()
