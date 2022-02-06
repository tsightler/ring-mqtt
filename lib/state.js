const writeFileAtomic = require('write-file-atomic')

class State {
    constructor() {
        this.file = '/data/ring-state.json'
    }

    // Save updated refresh token to config or state file
    async updateToken(newRefreshToken, oldRefreshToken, stateFile, stateData, configFile) {
        if (!oldRefreshToken) { return }
        if (process.env.RUNMODE === 'addon' || process.env.RUNMODE === 'docker') {
            stateData.ring_token = newRefreshToken
            try {
                await writeFileAtomic(stateFile, JSON.stringify(stateData, null, 2))
                debug('File ' + stateFile + ' saved with updated refresh token.')
            } catch (err) {
                debug('File '+stateFile+' save failed with error '+err)
            }
        } else if (configFile) {
            CONFIG.ring_token = newRefreshToken
            try {
                await writeFileAtomic(configFile, JSON.stringify(CONFIG, null, 4))
                debug('Config file saved with updated refresh token.')
            } catch (err) {
                debug('Config file save failed with error:'+err)
            }
        }
    }
}

module.exports = new State()