import { parentPort, workerData } from 'worker_threads'
import { WebrtcConnection } from '../node_modules/ring-client-api/lib/streaming/webrtc-connection.js'
import { RingEdgeConnection } from '../node_modules/ring-client-api/lib/streaming/ring-edge-connection.js'
import { StreamingSession } from '../node_modules/ring-client-api/lib/streaming/streaming-session.js'
import chalk from 'chalk'
import debugModule from 'debug'
const debug = debugModule('ring-mqtt')

const deviceName = workerData.deviceName
const doorbotId = workerData.doorbotId
let liveStream = false

parentPort.on("message", async(data) => {
    const streamData = data.streamData
    if (data.command === 'start' && !liveStream) {
        try {
            const cameraData = {
                name: deviceName,
                id: doorbotId
            }
            const streamConnection = (streamData.sessionId)
                ? new WebrtcConnection(streamData.sessionId, cameraData)
                : new RingEdgeConnection(streamData.authToken, cameraData)
            liveStream = new StreamingSession(cameraData, streamConnection)

            liveStream.connection.pc.onConnectionState.subscribe(async (data) => {
                switch(data) {
                    case 'connected':
                        parentPort.postMessage({ state: 'active' })
                        break;
                    case 'failed':
                        parentPort.postMessage({ state: 'failed' })
                        liveStream.stop()
                        await new Promise(res => setTimeout(res, 2000))
                        liveStream = false
                        break;
                }
            })

            await liveStream.startTranscoding({
                // The native AVC video stream is copied to the RTSP server unmodified while the audio 
                // stream is converted into two output streams using both AAC and Opus codecs.  This
                // provides a stream with wide compatibility across various media player technologies.
                audio: [
                    '-map', '0:v',
                    '-map', '0:a',
                    '-map', '0:a',
                    '-c:a:0', 'libfdk_aac',
                    '-profile:a:0', 'aac_eld',
                    '-c:a:1', 'copy',
                ],
                video: [
                    '-c:v', 'copy',
                ],
                output: [
                    '-flags', '+global_header',
                    '-f', 'rtsp',
                    '-rtsp_transport', 'tcp',
                    streamData.rtspPublishUrl
                ]
            })

            liveStream.onCallEnded.subscribe(() => {
                debug(chalk.green(`[${deviceName}] `)+'Live stream for camera has ended')
                parentPort.postMessage({ state: 'inactive' })
                liveStream = false
            })
        } catch(e) {
            debug(e)
            parentPort.postMessage({ state: 'failed' })
            liveStream = false
        }
    } else if (data.command === 'stop') {
        if (liveStream) {
            liveStream.stop()
            if (liveStream) {
                parentPort.postMessage({ state: 'inactive' })
            }
            process.kill()
        } else {
            debug(chalk.green(`[${deviceName}] `)+'Received live stream stop command but no active live call found')
            parentPort.postMessage({ state: 'inactive' })
        }
    }
})  