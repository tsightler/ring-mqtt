const debug = require('debug')('ring-rtsp-server')
const colors = require('colors/safe')
const utils = require('./utils.js')
const http = require('http');
const { spawn } = require('child_process')
const readline = require('readline')

class RtspSimpleServer {
    constructor() {
        this.started = false
    }

    async start(cameras) {
        if (cameras) {
            this.cameras = cameras
        }
        this.started = true
        debug(colors.green('-'.repeat(80)))
        debug('Starting rtsp-simple-server process...')

        const rssProcess = spawn('./bin/rtsp-simple-server', ['./config/rtsp-simple-server.yml'], {
            env: process.env,   // set env vars
            cwd: '.',           // set cwd
            stdio: 'pipe'       // forward stdio options
        })

        rssProcess.on('spawn', async () => {
            await utils.sleep(1) // Give the process a second to start the API server
            this.createAllRtspPaths()
        })

        rssProcess.on('close', async (code) => {
            if (this.started !== 'shutdown') {
                debug('The rtsp-simple-server process exited unexpectedly, will restart in 5 seconds...')
                await utils.sleep(5)
                this.start()
            }
        })

        const stdoutLine = readline.createInterface({ input: rssProcess.stdout })
        stdoutLine.on('line', (line) => {
            // Strip date from rtps-simple-server log messages
            debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, ''))
        })
            
        const stderrLine = readline.createInterface({ input: rssProcess.stderr })
        stderrLine.on('line', (line) => {
            // Strip date from rtps-simple-server log messages
            debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, ''))
        })
    }

    shutdown() {
        this.started = 'shutdown'
        return
    }

    async createAllRtspPaths() {
        debug('Creating RTSP paths for all cameras...')
        for (const camera of this.cameras) {
            await utils.msleep(50) // Needed to serialize API requests as rtsp-simple-server API does not appear to be thread safe
            const rtspPathConfig = JSON.stringify({
                source: 'publisher',
                runOnDemand: `./scripts/start-stream.sh "${camera.deviceId}_live" "${camera.deviceData.name}" "${camera.deviceTopic}/stream/attributes" "${camera.deviceTopic}/stream/command"`,
                runOnReadRestart: false,
                runOnDemandStartTimeout: 20000000000,
                runOnDemandCloseAfter: 5000000000
            })

            const httpOptions = {
                hostname: 'localhost',
                port: 8880,
                path: `/v1/config/paths/add/${camera.deviceId}_live`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': rtspPathConfig.length
                }
            }

            const req = http.request(httpOptions, res => {
                //debug(`statusCode: ${res.statusCode}`)
            
                res.on('data', d => {
                    if (d.toString()) {
                        debug(d.toString())
                    }
                })
            })
            
            req.on('error', error => {
                debug(error)
            })
            
            req.write(rtspPathConfig)
            req.end()
        }
        await utils.msleep(100)
        debug(colors.green('-'.repeat(80)))
    }
}

module.exports = new RtspSimpleServer()