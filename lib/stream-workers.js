const utils = require('./utils')
const { Worker } = require('worker_threads')
const colors = require('colors/safe')

class StreamWorkers {
    constructor() {
        this.streamWorkers = []
    }

    init() {
        const cpuCores = utils.getCpuCores()
        let numWorkers = 1
        if (cpuCores > 4) {
            numWorkers = 4
        } else if (cpuCores > 2) {
            numWorkers = cpuCores
        }
        utils.debug(`Detected ${cpuCores} CPU cores, using ${numWorkers} live stream worker threads`)

        for (let i = 0; i < numWorkers; i++) {
            this.streamWorkers[i] = {
                liveCall: new Worker('./lib/livecall.js', {
                    workerData: {
                        workerId: i+1
                    }
                }),
                sessions: {}
            }

            this.streamWorkers[i].liveCall.on('message', (data) => {
                const session = this.getSession(data.sessionId)
                if (session) {
                    switch (data.state) {
                        case 'active':
                            utils.event.emit(`${session.deviceId}_livestream`, 'active', data.sessionId)
                            break;
                        case 'inactive':
                            utils.event.emit(`${session.deviceId}_livestream`, 'inactive', data.sessionId)
                            delete this.streamWorkers[session.workerId].sessions[data.sessionId]
                            break;
                        case 'failed':
                            utils.event.emit(`${session.deviceId}_livestream`, 'failed', data.sessionId)
                            delete this.streamWorkers[session.workerId].sessions[data.sessionId]
                            break;
                    }
                }
            })
        }

        utils.event.on('start_livestream', (deviceId, deviceName, sessionId, rtspPublishUrl) => {
            let workerId = 0
            for (const id in this.streamWorkers) {
                if (Object.keys(this.streamWorkers[id].sessions).length < Object.keys(this.streamWorkers[workerId].sessions).length) {
                    workerId = id
                }
            }
            utils.debug(colors.green(`[${deviceName}] `)+`Live stream request allocated to worker ${parseInt(workerId)+1} with ${Object.keys(this.streamWorkers[workerId].sessions).length} active sessions`)
            this.streamWorkers[workerId].sessions[sessionId] = { deviceId, workerId }
            this.streamWorkers[workerId].liveCall.postMessage({ command: 'start', deviceName, sessionId, rtspPublishUrl })
        })

        utils.event.on('stop_livestream', (sessionId) => {
            const session = this.getSession(sessionId)
            if (session) {
                this.streamWorkers[session.workerId].liveCall.postMessage({ command: 'stop', sessionId })
            } else {
                utils.debug('Received requirest to stop live stream session but no active session found')
            }
        })
    }

    getSession(sessionId) {
        let allSessions = {}
        for (const worker of this.streamWorkers) {
            allSessions = { ...allSessions, ...worker.sessions }
        }
        if (allSessions.hasOwnProperty(sessionId)) {
            return allSessions[sessionId]
        } else {
            return false
        }
    }
 }

module.exports = new StreamWorkers()