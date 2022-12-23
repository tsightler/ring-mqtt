const debug = require('debug')('ring-rtsp')
const colors = require('colors/safe')
const utils = require('./utils')
const { spawn } = require('child_process')
const readline = require('readline')
const yaml = require('js-yaml')
const writeFileAtomic = require('write-file-atomic')


class Go2RTC {
    constructor() {
        this.started = false
        this.go2rtcProcess = false
        this.config = {
            log: {
                level: "debug"
            },
            rtsp: {
                listen: ":8554",
                ...(utils.config.livestream_user && utils.config.livestream_pass)
                    ? { 
                        username: utils.config.livestream_user,
                        password: utils.config.livestream_pass
                    } : {}
            }
        }
        this.configFile = (process.env.RUNMODE === 'standard') 
            ? require('path').dirname(require.main.filename)+'/config/go2rtc.yaml'
            : '/data/go2rtc.yaml'
    }

    async init(cameras) {
        this.started = true
        debug(colors.green('-'.repeat(90)))
        debug('Creating go2rtc configuration and starting go2rtc process...')
        if (cameras) {
            this.config.streams = {}
            for (const camera of cameras) {
                this.config.streams[`${camera.deviceId}_live`] =  
                    `exec:./scripts/start-stream.sh "${camera.deviceData.name}" ${camera.deviceId} live ${camera.deviceTopic} {output}`
                this.config.streams[`${camera.deviceId}_event`] =  
                    `exec:./scripts/start-stream.sh "${camera.deviceData.name}" ${camera.deviceId} event ${camera.deviceTopic} {output}`
            }
            try {
                await writeFileAtomic(this.configFile, yaml.dump(this.config, { lineWidth: -1 }))
                debug('Successfully wrote go2rtc configuration file: '+this.configFile)
            } catch (err) {
                debug(colors.red('Failed to write go2rtc configuration file: '+this.configFile))
                debug(err.message)
            }
        }

        this.go2rtcProcess = spawn('go2rtc', ['-config', this.configFile], {
            env: process.env,   // set env vars
            cwd: '.',           // set cwd
            stdio: 'pipe'       // forward stdio options
        })

        this.go2rtcProcess.on('spawn', async () => {
            debug('The go2rtc process was started successfully')
            await utils.sleep(2) // Give the process a second to start the API server
            debug(colors.green('-'.repeat(90)))
        })

        this.go2rtcProcess.on('close', async () => {
            await utils.sleep(1) // Delay to avoid spurious messages if shutting down
            if (this.started !== 'shutdown') {
                debug('The go2rtc process exited unexpectedly, will restart in 5 seconds...')
                this.go2rtcProcess.kill(9)  // Sometimes rtsp-simple-server crashes and doesn't exit completely, try to force kill it
                await utils.sleep(5)
                this.init()
            }
        })

        const stdoutLine = readline.createInterface({ input: this.go2rtcProcess.stdout })
        stdoutLine.on('line', (line) => {
            // Strip date from rtsp-simple-server log messages since debug adds it's own
            // debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, ''))
            debug(line.replace(/\d{2}:\d{2}:\d{2}.\d{3} /g, ''))
        })
            
        const stderrLine = readline.createInterface({ input: this.go2rtcProcess.stderr })
        stderrLine.on('line', (line) => {
            // Strip date from rtsp-simple-server log messages since debug adds it's own
            // debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, ''))
            debug(line.replace(/\d{2}:\d{2}:\d{2}.\d{3} /g, ''))
        })
    }

    shutdown() {
        this.started = 'shutdown'
        if (this.go2rtcProcess) {
            this.go2rtcProcess.kill()
            this.go2rtcProcess = false
        }
        return
    }

    async getPathDetails(path) {
        try {
            const pathDetails = await got(`http://localhost:8880/v1/paths/list`).json()
            return pathDetails.items[path]
        } catch(err) {
            debug(colors.red(err.message))
        }
    }
}

module.exports = new Go2RTC()