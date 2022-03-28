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
            numWorkers = cpuCores-1
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
                const deviceSession = this.getDeviceSession(data.deviceId)
                if (deviceSession) {
                    switch (data.state) {
                        case 'active':
                            utils.event.emit(`${data.deviceId}_livestream`, 'active')
                            break;
                        case 'inactive':
                            utils.event.emit(`${data.deviceId}_livestream`, 'inactive')
                            delete this.streamWorkers[deviceSession.workerId].sessions[data.deviceId]
                            break;
                        case 'failed':
                            utils.event.emit(`${data.deviceId}_livestream`, 'failed')
                            delete this.streamWorkers[deviceSession.workerId].sessions[data.deviceId]
                            break;
                    }
                }
            })
        }

        utils.event.on('start_livestream', (deviceId, cameraData, authToken, rtspPublishUrl) => {
            let workerId = 0
            for (const id in this.streamWorkers) {
                if (Object.keys(this.streamWorkers[id].sessions).length < Object.keys(this.streamWorkers[workerId].sessions).length) {
                    workerId = id
                }
            }
            utils.debug(colors.green(`[${cameraData.name}] `)+`Live stream request allocated to worker ${parseInt(workerId)+1} with ${Object.keys(this.streamWorkers[workerId].sessions).length} active sessions`)
            this.streamWorkers[workerId].sessions[deviceId] = { workerId }
            this.streamWorkers[workerId].liveCall.postMessage({ command: 'start', deviceId, cameraData, authToken, rtspPublishUrl })
        })

        utils.event.on('stop_livestream', (deviceId) => {
            const deviceSession = this.getDeviceSession(deviceId)
            if (deviceSession) {
                this.streamWorkers[deviceSession.workerId].liveCall.postMessage({ command: 'stop', deviceId })
            } else {
                utils.debug('Received requirest to stop live stream session but no active session found')
            }
        })
    }

    getDeviceSession(deviceId) {
        let allSessions = {}
        for (const worker of this.streamWorkers) {
            allSessions = { ...allSessions, ...worker.sessions }
        }
        if (allSessions.hasOwnProperty(deviceId)) {
            return allSessions[deviceId]
        } else {
            return false
        }
    }
 }

module.exports = new StreamWorkers()