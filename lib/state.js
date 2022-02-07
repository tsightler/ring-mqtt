const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const fs = require('fs')
const { createHash, randomBytes } = require('crypto')
const writeFileAtomic = require('write-file-atomic')

class State {
    constructor() {
        this.valid = false
        this.data = { 
            ring_token: '',
            systemId: '',
            devices: []
        }
    }

    async init(config) {
        this.config = config
        switch (this.config.runMode) {
            case 'docker':
            case 'addon':
                this.file = '/data/ring-state.json'
                await this.loadStateData()
                break;
            default:
                this.file = false
        }
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
            } catch {
                debug(err.message)
                debug('Saved state file exist but could not be parsed!')
            }
        } else {
            debug(colors.brightYellow('File '+this.file+' not found. No saved state data available.'))
        }
    }

    // Save updated refresh token to config or state file
    async updateToken(newRefreshToken, oldRefreshToken) {
        if (!oldRefreshToken) { return }
        switch (this.config.runMode) {
            case 'addon':
            case 'docker':
                this.data.ring_token = newRefreshToken
                try {
                    await writeFileAtomic(this.file, JSON.stringify(this.data, null, 2))
                    debug('State file ' +this.file+ ' saved with updated refresh token.')
                } catch (err) {
                    debug('Saving state file '+this.file+' failed with error: ')
                    debug(err)
                }
                break;
            default:
                await this.config.updateConfig(newRefreshToken)
        }
    }
}

module.exports = new State()