const { parentPort } = require('worker_threads')
const { WebrtcConnection } = require('ring-client-api/lib/api/streaming/webrtc-connection')
const { RingEdgeConnection } = require('ring-client-api/lib/api/streaming/ring-edge-connection')
const { StreamingSession } = require('ring-client-api/lib/api/streaming/streaming-session')
const debug = require('debug')('ring-mqtt')
let activeCalls = []

function removeActiveCall(deviceId) {
    const callIndex = activeCalls.findIndex(call => call.deviceId === deviceId )
    if (callIndex > -1) {
        activeCalls.splice(callIndex, 1)
    }
    debug(activeCalls)
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
                    '-flags', '+global_header',
                    '-f', 'rtsp',
                    '-rtsp_transport', 'tcp',
                    streamData.rtspPublishUrl
                ]
            })
            const liveCallData = {
                deviceId: streamData.deviceId,
                sessionId: liveCall.sessionId
            }
            parentPort.postMessage({ state: 'active', liveCallData })
            liveCall.onCallEnded.subscribe(() => {
                parentPort.postMessage({ state: 'inactive', liveCallData })
                removeActiveCall(liveCallData.deviceId)
            })
            liveCall.deviceId = streamData.deviceId
            activeCalls.push(liveCall)
        } catch(e) {
            debug(e)
            parentPort.postMessage({ state: 'failed', liveCallData: { deviceId: streamData.deviceId }})
            return false
        }
    } else if (data.command === 'stop') {
        debug(activeCalls)
        if (activeCall) {
            activeCall.stop()
        } else {
            parentPort.postMessage({ state: 'inactive', liveCallData: { deviceId: streamData.deviceId }})
            removeActiveCall(streamData.deviceId)
        }
    }
})  
