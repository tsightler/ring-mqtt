const { parentPort } = require('worker_threads')
const { WebrtcConnection } = require('../node_modules/ring-client-api/lib/streaming/webrtc-connection')
const { RingEdgeConnection } = require('../node_modules/ring-client-api/lib/streaming/ring-edge-connection')
const { StreamingSession } = require('../node_modules/ring-client-api/lib/streaming/streaming-session')
const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
let activeCalls = []

function removeActiveCall(deviceId, deviceName) {
    const callIndex = activeCalls.findIndex(call => call.deviceId === deviceId )
    if (callIndex > -1) {
        debug(colors.green(`[${deviceName}] `)+'Removing active live stream handler')
        activeCalls.splice(callIndex, 1)
    }
}

parentPort.on("message", async(data) => {
    const streamData = data.streamData
    const activeCall = activeCalls.find(call => call.deviceId === streamData.deviceId)
    if (data.command === 'start' && !activeCall) {
        try {
            const cameraData = {
                name: streamData.deviceName,
                id: streamData.doorbotId
            }
            const streamConnection = (streamData.sessionId)
                ? new WebrtcConnection(streamData.sessionId, cameraData)
                : new RingEdgeConnection(streamData.authToken, cameraData)
            const liveCall = new StreamingSession(cameraData, streamConnection)
            await liveCall.startTranscoding({
                // The native AVC video stream is copied to the RTSP server unmodified while the audio 
                // stream is converted into two output streams using both AAC and Opus codecs.  This
                // provides a stream with wide compatibility across various media player technologies.
                audio: [
                    '-map', '0:v',
                    '-map', '0:a',
                    '-map', '0:a',
                    '-c:a:0', 'libfdk_aac',
                    '-c:a:1', 'copy',
                ],
                video: [
                    '-c:v', 'copy',
                ],
                output: [
                    '-f', 'rtsp',
                    '-rtsp_transport', 'tcp',
                    streamData.rtspPublishUrl
                ]
            })
            liveCall.requestKeyFrame()
            const liveCallData = {
                deviceId: streamData.deviceId,
                sessionId: liveCall.sessionId
            }
            parentPort.postMessage({ state: 'active', liveCallData })
            liveCall.onCallEnded.subscribe(() => {
                debug(colors.green(`[${streamData.deviceName}] `)+'Live stream for camera has ended')
                parentPort.postMessage({ state: 'inactive', liveCallData })
                removeActiveCall(liveCallData.deviceId, streamData.deviceName)
            })
            liveCall.deviceId = streamData.deviceId
            activeCalls.push(liveCall)
        } catch(e) {
            debug(e)
            parentPort.postMessage({ state: 'failed', liveCallData: { deviceId: streamData.deviceId }})
            return false
        }
    } else if (data.command === 'stop') {
        if (activeCall) {
            activeCall.stop()
        } else {
            debug(colors.green(`[${streamData.deviceName}] `)+'Received live stream stop command but no active live call found')
            parentPort.postMessage({ state: 'inactive', liveCallData: { deviceId: streamData.deviceId }})
        }
    }
})  
