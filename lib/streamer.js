import chalk from 'chalk'
import utils from './utils.js'
import { spawn } from 'child_process'
import readline from 'readline'
import { WebSocketServer } from 'ws'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import pathToFfmpeg from 'ffmpeg-for-homebridge'
import debugModule from 'debug'
const debug = debugModule('ring-rtsp')

// Port for the control socket. This is the same port the embedded MQTT broker
// used to occupy: it served only to relay stream commands between the shell
// scripts and this process, and the socket replaces that job entirely.
const CONTROL_PORT = 51883
const CONTROL_PATH = '/ringstream'

// Streamer supervises the ringstream helper, which serves every camera over
// RTSP and starts them on demand.
//
// It replaces go2rtc plus the exec source, two shell scripts, the mosquitto
// CLI and the MQTT round trip they used to reach this process. The helper asks
// for what only this process can provide -- a Ring signaling ticket -- and
// reports stream state back for the MQTT entities.
export default new class Streamer {
    constructor() {
        this.started = false
        this.process = false
        this.wss = false
        this.socket = false
        this.cameras = new Map()
    }

    async init(cameras) {
        if (cameras) {
            this.cameras = new Map()
            for (const camera of cameras) {
                this.cameras.set(`${camera.deviceId}_live`, camera)
                this.cameras.set(`${camera.deviceId}_event`, camera)
            }
        }

        if (this.started) {
            // Cameras can be discovered after the helper is already running, so
            // push the new list rather than restarting it.
            this.sendCameras()
            return
        }
        this.started = true

        debug(chalk.green('-'.repeat(90)))
        debug('Starting the ringstream helper and control socket...')

        this.startControlServer()
        this.startHelper()
    }

    startControlServer() {
        this.wss = new WebSocketServer({ host: '127.0.0.1', port: CONTROL_PORT, path: CONTROL_PATH })

        this.wss.on('connection', (socket) => {
            debug('The stream helper connected to the control socket')
            this.socket = socket

            socket.on('message', (data) => this.onMessage(data))

            socket.on('close', () => {
                if (this.socket === socket) { this.socket = false }
                debug('The stream helper disconnected from the control socket')
            })

            socket.on('error', (error) => debug(chalk.red(`Control socket error: ${error.message}`)))
        })

        this.wss.on('error', (error) => {
            debug(chalk.red(`Could not start the control socket: ${error.message}`))
        })
    }

    send(message) {
        if (!this.socket || this.socket.readyState !== 1) { return false }
        this.socket.send(JSON.stringify(message))
        return true
    }

    sendCameras() {
        this.send({
            type: 'cameras',
            cameras: [...this.cameras.entries()].map(([path, camera]) => ({
                path,
                name: camera.deviceData.name,
                cameraId: camera.device.id,
                videoCodec: camera.getStreamVideoCodec()
            }))
        })
    }

    async onMessage(data) {
        let message
        try {
            message = JSON.parse(data.toString())
        } catch {
            debug(chalk.red('Received malformed data on the control socket'))
            return
        }

        switch (message.type) {
            case 'hello':
                // The helper reconnects on its own after a restart of either
                // side, so the camera list is sent on every connection rather
                // than only at startup.
                this.sendCameras()
                break;

            case 'ticket_request':
                await this.sendTicket(message)
                break;

            case 'recording_request':
                await this.sendRecording(message)
                break;

            case 'state': {
                const camera = this.cameras.get(message.path)
                if (camera) {
                    camera.onStreamState(message.path.endsWith('_event') ? 'event' : 'live', message.status)
                }
                break;
            }

            default:
                debug(`Ignoring unknown control message: ${message.type}`)
        }
    }

    // Only this process holds an authenticated Ring session, so the helper has
    // to come here for a signaling ticket.
    async sendTicket(message) {
        const camera = this.cameras.get(message.path)
        if (!camera) {
            this.send({ type: 'ticket', id: message.id, error: `no camera for ${message.path}` })
            return
        }

        const { ticket, error } = await camera.getSignalingTicket()
        this.send({ type: 'ticket', id: message.id, ticket, error })
    }

    // Recorded events live behind an authenticated Ring URL that only this
    // process can resolve, and which one to play depends on the event selector.
    async sendRecording(message) {
        const camera = this.cameras.get(message.path)
        if (!camera) {
            this.send({ type: 'recording', id: message.id, error: `no camera for ${message.path}` })
            return
        }

        const { recordingUrl, transcode, description, error } = await camera.getEventRecording()
        this.send({ type: 'recording', id: message.id, recordingUrl, transcode, description, error })
    }

    // start and stop cover the MQTT stream switch, which turns a camera on with
    // no RTSP client attached and so is not covered by on-demand activation.
    startStream(deviceId, kind = 'live') {
        return this.send({ type: 'start', path: `${deviceId}_${kind}` })
    }

    stopStream(deviceId, kind = 'live') {
        return this.send({ type: 'stop', path: `${deviceId}_${kind}` })
    }

    startHelper() {
        const helperPath = dirname(fileURLToPath(new URL('.', import.meta.url)))+'/ringstream/ringstream'

        const args = [
            '-daemon',
            '-control-url', `ws://127.0.0.1:${CONTROL_PORT}${CONTROL_PATH}`,
            '-rtsp-listen', ':8554',
            '-ffmpeg', pathToFfmpeg
        ]

        if (utils.config().livestream_user && utils.config().livestream_pass) {
            args.push('-rtsp-user', utils.config().livestream_user)
            args.push('-rtsp-pass', utils.config().livestream_pass)
        }

        this.process = spawn(helperPath, args, { env: process.env, stdio: 'pipe' })

        this.process.on('spawn', () => {
            debug('The ringstream helper was started successfully')
            debug(chalk.green('-'.repeat(90)))
        })

        this.process.on('error', (error) => {
            debug(chalk.red(`Could not start the ringstream helper: ${error.message}`))
        })

        this.process.on('close', async () => {
            await utils.sleep(1)
            if (this.started !== 'shutdown') {
                debug('The ringstream helper exited unexpectedly, restarting in 5 seconds...')
                await utils.sleep(5)
                this.startHelper()
            }
        })

        for (const stream of [this.process.stdout, this.process.stderr]) {
            readline.createInterface({ input: stream }).on('line', (line) => {
                debug(line.replace(/^\d{2}:\d{2}:\d{2}\.\d{6} /, ''))
            })
        }
    }

    shutdown() {
        this.started = 'shutdown'
        if (this.process) {
            this.process.kill()
            this.process = false
        }
        if (this.wss) {
            this.wss.close()
            this.wss = false
        }
    }
}
