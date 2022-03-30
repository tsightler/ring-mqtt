const { parentPort } = require('worker_threads')
const { LiveCall } = require('ring-client-api/lib/api/live-call.js')
const debug = require('debug')
let activeCalls = []

parentPort.on("message", async(data) => {
    if (data.command === 'start' && !(activeCalls.find(call => call.sessionId === data.sessionId))) {
        const liveCall = new LiveCall(data.sessionId, { camera: { name: data.deviceName }})
        try {   
            await liveCall.startTranscoding({
                // The below takes the native AVC video stream from Rings servers and just 
                // copies the video stream to the RTSP server unmodified.  However, for
                // audio it splits the Opus stream into two output streams one
                // being converted to AAC audio, and the other to a G.711 stream.
                // This allows support for playback methods that either don't support AAC
                // (e.g. native browser based WebRTC) and provides stong compatibility across
                // the various playback technolgies with minimal processing overhead.
                input: [
                    '-max_delay', '500000',
                    '-fflags', '+genpts'
                ],
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
            parentPort.postMessage({ state: 'active', sessionId: data.sessionId })
            liveCall.onCallEnded.subscribe(() => {
                parentPort.postMessage({ state: 'inactive', sessionId: data.sessionId })
                const callIndex = activeCalls.findIndex(call => call.sessionId === data.sessionId )
                if (callIndex > -1) {
                    activeCalls.splice(callIndex, 1)
                }
            })
        } catch(e) {
            debug(e)
            parentPort.postMessage({ state: 'failed', sessionId: data.sessionId })
            return false
        }
        activeCalls.push(liveCall)
    } else if (data.command === 'stop') {
        const activeCall = activeCalls.find(call => call.sessionId === data.sessionId)
        if (activeCall) {
            activeCall.stop()
        }
    }
})  
