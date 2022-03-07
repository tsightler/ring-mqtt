const { workerData, parentPort } = require('worker_threads')
const { RingApi } = require('@tsightler/ring-client-api')
const debug = require('debug')

async function startLiveStream(camera) {
    // Start and publish stream to rtsp-simple-server 
    try {        
        const liveStreamSession = await camera.streamVideo({
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
        liveStreamSession.onCallEnded.subscribe(() => {
            parentPort.postMessage('inactive')
        })
        return liveStreamSession
    } catch(e) {
        debug(e)
        parentPort.postMessage('failed')
        return false
    }
}

const main = async() => {
    let liveStreamSession
    const ringAuth = {
        refreshToken: workerData.ringAuth.refreshToken,
        systemId: workerData.ringAuth.systemId,
        locationIds: [ `${workerData.locationId}` ]
    }

    const ringClient = new RingApi(ringAuth)
    const locations = await ringClient.getLocations()
    const camera = locations[0].cameras.find(c => c.data.device_id === workerData.deviceId)

    parentPort.on("message", async(command) => {
        if (command === 'start' && !liveStreamSession) {
            liveStreamSession = await startLiveStream(camera)
        } else if (command === 'stop' && liveStreamSession) {
            liveStreamSession.stop()
            liveStreamSession = false
        }
    })  
}

main()