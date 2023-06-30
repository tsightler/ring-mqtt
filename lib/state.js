import chalk from 'chalk'
import fs from 'fs'
import { readFile } from 'fs/promises'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import utils from './utils.js'
import { createHash, randomBytes } from 'crypto'
import writeFileAtomic from 'write-file-atomic'
import debugModule from 'debug'
const debug = debugModule('ring-mqtt')

export default new class State {
    constructor() {
        this.valid = false
        this.writeScheduled = false
        this.data = {
            ring_token: '',
            systemId: '',
            devices: {}
        }
    }

    async init() {
        this.file = (process.env.RUNMODE === 'standard')
            ? dirname(fileURLToPath(new URL('.', import.meta.url)))+'/ring-state.json'
            : '/data/ring-state.json'
        await this.loadStateData()

        // Only temporary to remove any legacy values from state file
        if (this.data.hasOwnProperty('push_credentials')) {
            delete this.data.push_credentials
            await this.saveStateFile()
        }
    }

    async loadStateData() {
        if (fs.existsSync(this.file)) {
            debug('Reading latest data from state file: '+this.file)
            try {
                this.data = JSON.parse(await readFile(this.file))
                this.valid = true
                if (!this.data.hasOwnProperty('systemId')) {
                    this.data.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
                }
                // Convert legacy state file with empty device array
                if (!this.data.hasOwnProperty('devices') || Array.isArray(this.data.devices)) {
                    this.data.devices = {}
                }
            } catch (err) {
                debug(err.message)
                debug(chalk.red('Saved state file exist but could not be parsed!'))
                await this.initStateData()
            }
        } else {
            await this.initStateData()
        }
    }

    async initStateData() {
        this.data.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
        debug(chalk.yellow('State file '+this.file+' not found. No saved state data available.'))
    }

    async saveStateFile() {
        // The writeScheduled flag is a hack to keep from writing too often when there are burst
        // of state updates such as during startup. If a state file update is already scheduled
        // then calls to this function are skipped.
        if (!this.writeScheduled) {
            this.writeScheduled = true
            await utils.sleep(1)
            this.writeScheduled = false
            try {
                await writeFileAtomic(this.file, JSON.stringify(this.data))
                debug('Successfully saved updated state file: '+this.file)
            } catch (err) {
                debug(chalk.red('Failed to save updated state file: '+this.file))
                debug(err.message)
            }
        }
    }

    updateToken(newRefreshToken) {
        debug('Saving updated refresh token to state file')
        this.data.ring_token = newRefreshToken
        this.saveStateFile()
    }

    setDeviceSavedState(deviceId, stateData) {
        this.data.devices[deviceId] = stateData
        this.saveStateFile()
    }

    getDeviceSavedState(deviceId) {
        return this.data.devices.hasOwnProperty(deviceId) ? this.data.devices[deviceId] : false
    }

    getAllSavedStates() {
        return this.data.devices
    }
}
