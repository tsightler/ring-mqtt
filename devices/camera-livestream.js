import { parentPort, workerData } from 'worker_threads'
import { WebrtcConnection } from '../lib/streaming/webrtc-connection.js'
import { StreamingSession } from '../lib/streaming/streaming-session.js'

const deviceName = workerData.deviceName
const doorbotId = workerData.doorbotId
let liveStream = false
let audioStream = false
let streamStopping = false

parentPort.on("message", async(data) => {
    const streamData = data.streamData
    switch (data.command) {
        case 'start':
            if (streamStopping) {
                parentPort.postMessage({type: 'log_error', data: "Live stream could not be started because it is in stopping state"})
                parentPort.postMessage({type: 'state', data: 'failed'})
            } else if (!liveStream) {
                startLiveStream(streamData)
            } else {
                parentPort.postMessage({type: 'log_error', data: "Live stream could not be started because there is already an active stream"})
                parentPort.postMessage({type: 'state', data: 'active'})
            }
            break;
        case 'stop':
            if (liveStream) {
                stopLiveStream()
            }
            break;
        case 'play_audio':
            playAudio(streamData)
            break;
        case 'stop_audio':
            stopAudio()
            break;
    }
})

async function startLiveStream(streamData) {
    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC worker received start command'})
    try {
        const cameraData = {
            name: deviceName,
            id: doorbotId
        }

        const streamConnection = new WebrtcConnection(streamData.ticket, cameraData)
        liveStream = new StreamingSession(cameraData, streamConnection)

        liveStream.connection.pc.onConnectionState.subscribe(async (data) => {
            switch(data) {
                case 'connected':
                    parentPort.postMessage({type: 'state', data: 'active'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session is connected'})
                    break;
                case 'failed':
                    parentPort.postMessage({type: 'state', data: 'failed'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC connection has failed'})
                    liveStream.stop()
                    await new Promise(res => setTimeout(res, 2000))
                    liveStream = false
                    break;
            }
        })

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process is starting'})
        await liveStream.startTranscoding({
            // The native AVC video stream is copied to the RTSP server unmodified while the audio
            // stream is converted into two output streams using both AAC and Opus codecs.  This
            // provides a stream with wide compatibility across various media player technologies.
            audio: [
                '-map', '0:v',
                '-map', '0:a',
                '-map', '0:a',
                '-c:a:0', 'aac',
                '-c:a:1', 'copy',
            ],
            video: [
                '-c:v', 'copy'
            ],
            output: [
                '-flags', '+global_header',
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                streamData.rtspPublishUrl
            ]
        })

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process has started'})

        liveStream.onCallEnded.subscribe(() => {
            parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session has disconnected'})
            parentPort.postMessage({type: 'state', data: 'inactive'})
            liveStream = false
        })
    } catch(error) {
        parentPort.postMessage({type: 'log_error', data: error})
        parentPort.postMessage({type: 'state', data: 'failed'})
        liveStream = false
    }
}

async function playAudio(streamData) {
    if (!streamData || !streamData.audioFile) {
        parentPort.postMessage({type: 'log_error', data: 'Play audio command received without an audio file'})
        return
    }

    if (liveStream) {
        try {
            parentPort.postMessage({type: 'log_info', data: `Playing audio clip on active live stream: ${streamData.audioFile}`})
            liveStream.activateCameraSpeaker()
            await liveStream.transcodeReturnAudio({ input: [streamData.audioFile] }, { endCallOnFinish: false })
        } catch(error) {
            parentPort.postMessage({type: 'log_error', data: error})
        }
        return
    }

    if (audioStream && audioStream.cameraSpeakerActivated) {
        try {
            parentPort.postMessage({type: 'log_info', data: `Switching audio playback to: ${streamData.audioFile}`})
            await audioStream.transcodeReturnAudio({ input: [streamData.audioFile] })
        } catch(error) {
            parentPort.postMessage({type: 'log_error', data: error})
        }
        return
    }

    if (audioStream) {
        audioStream.stop()
        audioStream = false
    }

    parentPort.postMessage({type: 'log_info', data: `Starting standalone audio playback session: ${streamData.audioFile}`})
    try {
        const cameraData = {
            name: deviceName,
            id: doorbotId
        }

        const streamConnection = new WebrtcConnection(streamData.ticket, cameraData)
        audioStream = new StreamingSession(cameraData, streamConnection)

        audioStream.onCallEnded.subscribe(() => {
            parentPort.postMessage({type: 'log_info', data: 'Audio playback session has ended'})
            audioStream = false
        })

        let playbackStarted = false
        audioStream.connection.pc.onConnectionState.subscribe(async (state) => {
            switch(state) {
                case 'connected':
                    if (playbackStarted) { break }
                    playbackStarted = true
                    parentPort.postMessage({type: 'log_info', data: 'Audio playback WebRTC session is connected'})
                    audioStream.activateCameraSpeaker()
                    await audioStream.transcodeReturnAudio({ input: [streamData.audioFile] })
                    break;
                case 'failed':
                    parentPort.postMessage({type: 'log_error', data: 'Audio playback WebRTC connection has failed'})
                    if (audioStream) {
                        audioStream.stop()
                        audioStream = false
                    }
                    break;
            }
        })
    } catch(error) {
        parentPort.postMessage({type: 'log_error', data: error})
        audioStream = false
    }
}

function stopAudio() {
    if (audioStream) {
        parentPort.postMessage({type: 'log_info', data: 'Stopping audio playback'})
        audioStream.stop()
        audioStream = false
    } else if (liveStream) {
        parentPort.postMessage({type: 'log_info', data: 'Stopping audio playback on live stream'})
        liveStream.stopReturnAudio()
    }
}

async function stopLiveStream() {
    if (!streamStopping) {
        streamStopping = true
        let stopTimeout = 10
        liveStream.stop()
        do {
            await new Promise(res => setTimeout(res, 200))
            if (liveStream) {
                parentPort.postMessage({type: 'log_info', data: 'Live stream failed to stop on request, deleting anyway...'})
                parentPort.postMessage({type: 'state', data: 'inactive'})
                liveStream = false
            }
            stopTimeout--
        } while (liveStream && stopTimeout)
        streamStopping = false
    }
}