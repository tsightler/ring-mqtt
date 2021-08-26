const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const utils = require('./utils.js')
const http = require('http');
const { spawn } = require('child_process');

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

        this.rssProcess = spawn('./bin/rtsp-simple-server', ['./config/rtsp-simple-server.yml'], {
            env: process.env,   // set env vars
            cwd: '.',           // set cwd
            stdio: 'pipe'       // forward stdio options
        })

        this.rssProcess.on('spawn', async () => {
            await utils.sleep(1) // Give the process a few milliseconds to start the API
            this.createAllRtspPaths()
        })

        this.rssProcess.on('close', async (code) => {
            if (this.started !== 'shutdown') {
                debug('The rtsp-simple-server process exited unexpectedly, will restart in 5 seconds...')
                await utils.sleep(5)
                this.start()
            }
        })

        this.rssProcess.stdout.on('data', (data) => {
            if (data.toString()) {
                debug(data.toString().replace(/(\r\n|\n|\r)/gm, ""))
            }
        })
            
        this.rssProcess.stderr.on('data', (data) => {
            if (data.toString()) {
                debug(data.toString().replace(/(\r\n|\n|\r)/gm, ""))
            }
        })
    }

    shutdown() {
        this.started = 'shutdown'
        return
    }

    async createAllRtspPaths() {
        debug('Creating publishing paths for all cameras...')
        for (const camera of this.cameras) {
            await utils.msleep(50)
            const rtspPathConfig = JSON.stringify({
                source: 'publisher',
                runOnDemand: `node ./lib/start-stream.js ${camera.deviceId}_stream ${camera.deviceTopic}/stream/state ${camera.deviceTopic}/stream/command`,
                runOnReadRestart: false,
                runOnDemandStartTimeout: 10000000000,
                runOnDemandCloseAfter: 10000000000
            })

            const httpOptions = {
                hostname: 'localhost',
                port: 55456,
                path: `/v1/config/paths/add/${camera.deviceId}_stream`,
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