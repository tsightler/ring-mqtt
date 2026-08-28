import { parentPort, workerData } from 'worker_threads'
import { WebrtcConnection } from '../lib/streaming/webrtc-connection.js'
import { StreamingSession } from '../lib/streaming/streaming-session.js'

const deviceName = workerData.deviceName
const doorbotId = workerData.doorbotId
let liveStream = false
let streamStopping = false

// Set between asking the main process for a codec fallback retry and the replacement
// start command arriving, so that a stop received in that window is not lost
let codecRetryPending = false

// Only one video codec is offered at a time, and a camera which will not stream it can
// fail by never answering, by having the answer refused, or by answering and then never
// sending anything.  All three are bounded so that the session can be retried with the
// other codec.  Ring normally answers in well under a second and video normally starts
// within a second of that, so both of these are already generous.
const answerTimeout = 5000
const videoStartTimeout = 8000

parentPort.on("message", async(data) => {
    const streamData = data.streamData
    switch (data.command) {
        case 'start':
            if (streamData?.codecRetry && !codecRetryPending) {
                // A stop arrived while this retry was being prepared, so honour the stop
                parentPort.postMessage({type: 'log_info', data: 'Abandoning codec fallback retry because the live stream was stopped'})
                parentPort.postMessage({type: 'state', data: 'inactive'})
            } else if (streamStopping) {
                parentPort.postMessage({type: 'log_error', data: "Live stream could not be started because it is in stopping state"})
                parentPort.postMessage({type: 'state', data: 'failed'})
            } else if (!liveStream) {
                codecRetryPending = false
                startLiveStream(streamData)
            } else {
                parentPort.postMessage({type: 'log_error', data: "Live stream could not be started because there is already an active stream"})
                parentPort.postMessage({type: 'state', data: 'active'})
            }
            break;
        case 'stop':
            if (liveStream) {
                stopLiveStream()
            } else if (codecRetryPending) {
                // Cancel the retry which the main process is currently preparing
                codecRetryPending = false
                parentPort.postMessage({type: 'state', data: 'inactive'})
            }
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

        const streamConnection = new WebrtcConnection(streamData.ticket, cameraData, {
            videoCodec: streamData.videoCodec
        })
        liveStream = new StreamingSession(cameraData, streamConnection)

        // Set while a codec fallback retry is in progress so that the session ending is
        // not reported as the stream going inactive, which would cause the RTSP server
        // to drop the waiting client before the retry has a chance to connect
        let retryingCodec = false

        liveStream.onCallEnded.subscribe(() => {
            if (retryingCodec) { return }
            parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session has disconnected'})
            parentPort.postMessage({type: 'state', data: 'inactive'})
            liveStream = false
        })

        // Watch for video from the moment the session exists so that packets arriving
        // before the answer has finished being processed are never missed
        let videoSubscription
        const firstVideoPacket = new Promise((resolve) => {
            videoSubscription = liveStream.onVideoRtp.subscribe(() => resolve(true))
        })
        const callEnded = new Promise((resolve) => {
            liveStream.onCallEnded.subscribe(() => resolve(false))
        })

        // A transport level connection failure is not a codec problem, so it must not
        // trigger a fallback to the other codec
        let connectionFailed = false


        let negotiatedVideoCodec = null
        let receivedVideoCodec = null
        streamConnection.onVideoCodec.subscribe((codec) => { negotiatedVideoCodec = codec })
        const firstPacketCodec = new Promise((resolve) => {
            streamConnection.onReceivedVideoCodec.subscribe(resolve)
        })

        liveStream.connection.pc.onConnectionState.subscribe(async (data) => {
            switch(data) {
                case 'connected':
                    parentPort.postMessage({type: 'state', data: 'active'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session is connected'})
                    break;
                case 'failed':
                    connectionFailed = true
                    parentPort.postMessage({type: 'state', data: 'failed'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC connection has failed'})
                    if (liveStream) { liveStream.stop() }
                    await new Promise(res => setTimeout(res, 2000))
                    liveStream = false
                    break;
            }
        })

        // Start the transcoder now rather than after video is confirmed, so that it spawns
        // and parses the SDP while the first packets are still arriving.  Nothing is lost
        // because the session buffers RTP until ffmpeg is ready, and ffmpeg cannot publish
        // to the RTSP server until it has decodable video, so a session abandoned for a
        // codec retry is still invisible to the client waiting on the other end.
        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process is starting'})
        const transcoding = liveStream.startTranscoding({
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
            // Video is always copied unmodified, including H.265/HEVC.  Transcoding HEVC
            // back to H.264 would be far too expensive for the low powered hardware this
            // often runs on, so downstream players have to handle HEVC themselves.
            video: [
                '-c:v', 'copy'
            ],
            // +global_header would move the parameter sets out of the stream and into the
            // SDP alone, leaving a decoder which has to reconfigure part way through with
            // nothing to recover from.  ffmpeg sets the flag itself for muxers which need
            // it, so saying so here only removes the chance of them being sent in band.
            output: [
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                streamData.rtspPublishUrl
            ]
        }).catch((error) => {
            parentPort.postMessage({type: 'log_error', data: `Live stream transcoding process failed to start: ${error.message}`})
        })

        // Ring must answer before there is any point in waiting for video, and both waits
        // are bounded because a camera which cannot stream the offered codec fails in
        // several different ways: no answer at all, an answer Ring's media server will not
        // accept, or an accepted answer followed by silence
        const answered = await Promise.race([
            liveStream.isUsingHevc.then(() => true),
            callEnded,
            new Promise((resolve) => setTimeout(() => resolve(false), answerTimeout))
        ])

        const videoStarted = answered
            ? await Promise.race([
                firstVideoPacket,
                callEnded,
                new Promise((resolve) => setTimeout(() => resolve(false), videoStartTimeout))
            ])
            : false
        videoSubscription.unsubscribe()

        const offeredCodec = streamData.videoCodec === 'auto' ? 'both codecs' : `${streamData.videoCodec.toUpperCase()} only`
        // With both codecs offered the one to try next is whichever Ring did not pick
        const retryCodec = streamData.videoCodec === 'auto'
            ? (negotiatedVideoCodec === 'h265' ? 'h264' : 'h265')
            : (streamData.videoCodec === 'h265' ? 'h264' : 'h265')

        if (!videoStarted) {
            // The session is only usable once video is actually flowing, so anything else
            // means this camera will not stream the codec that was offered.  The two
            // exceptions are a stop that was asked for and a transport level connection
            // failure, neither of which has anything to do with the codec.
            if (streamStopping || connectionFailed) {
                return
            }
            const reason = streamConnection.answerFailed
                ? `Camera would not accept an offer of ${offeredCodec}`
                : !answered
                    ? `Camera did not answer an offer of ${offeredCodec} within ${answerTimeout/1000} seconds`
                    : `Camera accepted an offer of ${offeredCodec} but sent no video within ${videoStartTimeout/1000} seconds`
            if (streamData.allowFallback && !streamData.codecRetry) {
                // Nothing has been published to the RTSP server yet, so retrying here is
                // invisible to the client which is still waiting for the stream to start
                retryingCodec = true
                codecRetryPending = true
                parentPort.postMessage({type: 'log_info', data: `${reason}, retrying with a ${retryCodec.toUpperCase()} only offer`})
                if (liveStream) { liveStream.stop() }
                liveStream = false
                parentPort.postMessage({type: 'retry_video_codec', data: retryCodec})
            } else {
                parentPort.postMessage({type: 'log_error', data: reason})
                if (streamData.codecRetry) {
                    // The remembered codec has stopped working, so forget it and let the
                    // next attempt work it out again from the configured setting
                    parentPort.postMessage({type: 'clear_video_codec'})
                }
                parentPort.postMessage({type: 'state', data: 'failed'})
                if (liveStream) { liveStream.stop() }
                liveStream = false
            }
            return
        }

        // The payload type of the first packet is the only reliable indication of what the
        // camera is really sending, and it arrives with that packet, so it is available
        // as soon as the probe above completes
        receivedVideoCodec = await Promise.race([
            firstPacketCodec,
            new Promise((resolve) => setTimeout(() => resolve(null), 1000))
        ])

        if (receivedVideoCodec && negotiatedVideoCodec && receivedVideoCodec !== negotiatedVideoCodec) {
            // ffmpeg is handed Ring's answer, which describes the negotiated codec, so it
            // discards every packet sent using a different payload type and can never
            // determine the frame size.  Offering only the codec the camera actually sends
            // makes Ring describe the stream correctly.
            if (streamData.allowFallback && !streamData.codecRetry && ['h264', 'h265'].includes(receivedVideoCodec)) {
                retryingCodec = true
                codecRetryPending = true
                parentPort.postMessage({type: 'log_info', data: `Camera negotiated ${negotiatedVideoCodec.toUpperCase()} but is sending ${receivedVideoCodec.toUpperCase()}, retrying with a ${receivedVideoCodec.toUpperCase()} only offer`})
                liveStream.stop()
                liveStream = false
                parentPort.postMessage({type: 'retry_video_codec', data: receivedVideoCodec})
                return
            }
            parentPort.postMessage({type: 'log_error', data: `Camera is sending ${receivedVideoCodec.toUpperCase()} but negotiated ${negotiatedVideoCodec.toUpperCase()}, the stream will not be usable`})
        }

        if (receivedVideoCodec === 'h265') {
            parentPort.postMessage({type: 'log_info', data: 'Ring is sending H.265/HEVC video which is passed through without transcoding, downstream players must be able to decode HEVC'})
        }

        await transcoding

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process has started'})
    } catch(error) {
        parentPort.postMessage({type: 'log_error', data: error})
        parentPort.postMessage({type: 'state', data: 'failed'})
        liveStream = false
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