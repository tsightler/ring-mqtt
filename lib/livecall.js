const { workerData, parentPort } = require('worker_threads')
const { LiveCall } = require('@tsightler/ring-client-api/lib/api/live-call.js')
const debug = require('debug')

let liveCall = false

parentPort.on("message", async(data) => {
    command = data[0]
    sessionId = data[1]
    if (command === 'start' && !liveCall) {
        liveCall = new LiveCall(sessionId, workerData.camera)
        try {   
            await liveCall.startTranscoding({
                // The below takes the native AVC video stream from Rings servers and just 
                // copies the video stream to the RTSP server unmodified.  However, for
                // audio it splits the G.711 μ-law stream into two output streams one
                // being converted to AAC audio, and the other just the raw G.711 stream.
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
                    workerData.rtspPublishUrl
                ]
            })
            parentPort.postMessage('active')
            liveCall.onCallEnded.subscribe(() => {
                parentPort.postMessage('inactive')
                liveCall = false
            })
        } catch(e) {
            debug(e)
            parentPort.postMessage('failed')
            return false
        }
    } else if (command === 'stop' && liveCall) {
        liveCall.stop()
    }
})  
