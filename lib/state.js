const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const fs = require('fs')
const utils = require( '../lib/utils' )
const { createHash, randomBytes } = require('crypto')
const writeFileAtomic = require('write-file-atomic')

class State {
    constructor() {
        this.valid = false
        this.writeDelay = false
        this.data = { 
            ring_token: '',
            systemId: '',
            devices: {}
        }
    }

    async init(config) {
        this.config = config
        this.file = (process.env.RUNMODE === 'standard') 
            ? require('path').dirname(require.main.filename)+'/ring-state.json'
            : this.file = '/data/ring-state.json'
        await this.loadStateData()

        utils.event.on(`saveDeviceState`, (deviceId, stateData) => {
            this.data.devices[deviceId] = stateData
            this.updateStateFile()
        })

        utils.event.on('getDeviceState', (deviceId) => {
            if (this.data.devices.hasOwnProperty(deviceId)) {
                utils.event.emit(`deviceState_${deviceId}`, this.data.devices[deviceId])
            } else {
                utils.event.emit(`deviceState_${deviceId}`, false)
            }
        })
    }

    async loadStateData() {
        if (fs.existsSync(this.file)) {
            debug('Reading latest data from state file: '+this.file)
            try {
                this.data = require(this.file)
                this.valid = true
                if (!this.data.hasOwnProperty('systemId')) {
                    this.data.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
                }
                // Convert legacy state file with empty device array
                if (!this.data.hasOwnProperty('devices') || Array.isArray(this.data.devices)) {
                    this.data.devices = {}
                }
            } catch {
                debug(err.message)
                debug(colors.red('Saved state file exist but could not be parsed!'))
                await this.initStateData()
            }
        } else {
            await this.initStateData()
        }
    }

    async initStateData() {
        this.data.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
        if (process.env.RUNMODE === 'standard' && this.config.data.hasOwnProperty('ring_token') && this.config.data.ring_token) {
            debug(colors.yellow('State file '+this.file+' not found, creating new state file using existing ring_token from config file.'))
            this.updateToken(this.config.data.ring_token, true)
            await this.config.updateConfig()
        } else {
            debug(colors.yellow('State file '+this.file+' not found. No saved state data available.'))
        }
    }

    async updateToken(newRefreshToken, oldRefreshToken) {
        if (oldRefreshToken) {
            this.data.ring_token = newRefreshToken
            this.updateStateFile()
        }
    }

    async updateStateFile() {
        if (!this.writeDelay) {
            this.writeDelay = true
            await utils.sleep(10)
            try {
                await writeFileAtomic(this.file, JSON.stringify(this.data))
                debug('Successfully saved updated refresh token in state file: '+this.file)
            } catch (err) {
                debug(colors.red('Failed to save updated refresh token in state file: '+this.file))
                debug(err.message)
            }
            this.writeDelay = false
        }
    }
}

module.exports = new State()