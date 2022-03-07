const debug = require('debug')('ring-rtsp')
const colors = require('colors/safe')
const utils = require('./utils')
const { spawn } = require('child_process')
const readline = require('readline')
const got = require('got')

class RtspSimpleServer {
    constructor() {
        this.started = false
        this.rssProcess = false
    }

    async start(cameras) {
        if (cameras) {
            this.cameras = cameras
        }
        this.started = true
        debug(colors.green('-'.repeat(73)))
        debug('Starting rtsp-simple-server process...')

        this.rssProcess = spawn('rtsp-simple-server', [`${__dirname}/../config/rtsp-simple-server.yml`], {
            env: process.env,   // set env vars
            cwd: '.',           // set cwd
            stdio: 'pipe'       // forward stdio options
        })

        this.rssProcess.on('spawn', async () => {
            await utils.sleep(1) // Give the process a second to start the API server
            this.createAllRtspPaths()
        })

        this.rssProcess.on('close', async () => {
            await utils.sleep(1) // Delay to avoid spurious messages if shutting down
            if (this.started !== 'shutdown') {
                debug('The rtsp-simple-server process exited unexpectedly, will restart in 5 seconds...')
                this.rssProcess.kill(9)  // Sometimes rtsp-simple-server crashes and doesn't exit completely, try to force kill it
                await utils.sleep(5)
                this.start()
            }
        })

        const stdoutLine = readline.createInterface({ input: this.rssProcess.stdout })
        stdoutLine.on('line', (line) => {
            // Strip date from rtps-simple-server log messages since debug adds it's own
            debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, ''))
        })
            
        const stderrLine = readline.createInterface({ input: this.rssProcess.stderr })
        stderrLine.on('line', (line) => {
            // Strip date from rtps-simple-server log messages since debug adds it's own
            debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, ''))
        })
    }

    shutdown() {
        this.started = 'shutdown'
        if (this.rssProcess) {
            this.rssProcess.kill()
            this.rssProcess = false
        }
        return
    }

    async createAllRtspPaths() {
        debug('Creating RTSP paths for all cameras...')
        for (const camera of this.cameras) {
            await utils.msleep(10)
            let rtspPathConfig = {
                source: 'publisher',
                runOnDemand: `./scripts/start-stream.sh "${camera.deviceData.name}" "${camera.deviceId}" "live" "${camera.deviceTopic}/"`,
                runOnDemandRestart: false,
                runOnDemandStartTimeout: '10s',
                runOnDemandCloseAfter: '10s',
                ...(utils.config.livestream_user && utils.config.livestream_pass) ? {
                    publishUser: utils.config.livestream_user,
                    publishPass: utils.config.livestream_pass,
                    readUser: utils.config.livestream_user,
                    readPass: utils.config.livestream_pass
                } : {}
            }

            try {
                await got.post(`http://localhost:8880/v1/config/paths/add/${camera.deviceId}_live`, { json: rtspPathConfig })
            } catch(err) {
                debug(colors.red(err.message))
            }

            await utils.msleep(10)
            rtspPathConfig = {
                source: 'publisher',
                runOnDemand: `./scripts/start-stream.sh "${camera.deviceData.name}" "${camera.deviceId}" "event" "${camera.deviceTopic}/event_"`,
                runOnDemandRestart: false,
                runOnDemandStartTimeout: '10s',
                runOnDemandCloseAfter: '10s',
                ...(utils.config.livestream_user && utils.config.livestream_pass) ? {
                    publishUser: utils.config.livestream_user,
                    publishPass: utils.config.livestream_pass,
                    readUser: utils.config.livestream_user,
                    readPass: utils.config.livestream_pass
                } : {}
            }

            try {
                await got.post(`http://localhost:8880/v1/config/paths/add/${camera.deviceId}_event`, { json: rtspPathConfig })
            } catch(err) {
                debug(colors.red(err.message))
            }
        }
        await utils.msleep(100)
        debug(colors.green('-'.repeat(73)))
    }

    async getPathDetails(path) {
        try {
            const pathDetails = await got(`http://localhost:8880/v1/paths/list`).json()
            return pathDetails.items[path]
        } catch(err) {
            debug(colors.red(err.message))
        }
    }

    async getActiveSessions() {
        try {
            return await got(`http://localhost:8880/v1/rtspsessions/list`).json()
        } catch(err) {
            debug(colors.red(err.message))
        }
    }
}

module.exports = new RtspSimpleServer()