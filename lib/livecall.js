const { parentPort } = require('worker_threads')
const { LiveCall } = require('ring-client-api/lib/api/live-call.js')
const debug = require('debug')
let activeCalls = []

parentPort.on("message", async(data) => {
    if (data.command === 'start' && !(activeCalls.find(call => call.deviceId === data.deviceId))) {
        const liveCall = new LiveCall(data.authToken, data.cameraData)
        try {
            liveCall.deviceId = data.deviceId
            await liveCall.startTranscoding({
                // The below takes the native AVC video stream from Rings servers and just 
                // copies the video stream to the RTSP server unmodified.  However, for
                // audio it splits the Opus stream into two output streams one
                // being converted to AAC audio, and the other to a G.711 stream.
                // This allows support for playback methods that either don't support AAC
                // (e.g. native browser based WebRTC) and provides stong compatibility across
                // the various playback technolgies with minimal processing overhead.
                audio: [
                    '-map', '0:a:0',
                    '-map', '0:a:0',
                    '-c:a:0', 'aac',
                    '-c:a:1', 'copy',
                ],
                video: [
                    '-map', '0:v:0',
                    '-vcodec', 'copy',
                ],
                output: [
                    '-f', 'rtsp',
                    '-rtsp_transport', 'tcp',
                    data.rtspPublishUrl
                ]
            })
            parentPort.postMessage({ state: 'active', deviceId: data.deviceId })
            liveCall.onCallEnded.subscribe(() => {
                parentPort.postMessage({ state: 'inactive', deviceId: data.deviceId })
                const callIndex = activeCalls.findIndex(call => call.deviceId === data.deviceId )
                if (callIndex > -1) {
                    activeCalls.splice(callIndex, 1)
                }
            })
        } catch(e) {
            debug(e)
            parentPort.postMessage({ state: 'failed', deviceId: data.deviceId })
            return false
        }
        activeCalls.push(liveCall)
    } else if (data.command === 'stop') {
        const activeCall = activeCalls.find(call => call.deviceId === data.deviceId)
        if (activeCall) {
            activeCall.stop()
        }
    }
})  
