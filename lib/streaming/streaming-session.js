import { FfmpegProcess, reservePorts, RtpSplitter, } from '@homebridge/camera-utils'
import { firstValueFrom, ReplaySubject, Subject } from 'rxjs'
import pathToFfmpeg from 'ffmpeg-for-homebridge'
import { concatMap, take } from 'rxjs/operators'
import { Subscribed } from './subscribed.js'

function getCleanSdp(sdp, includeVideo) {
    return sdp
        .split('\nm=')
        .slice(1)
        .map((section) => 'm=' + section)
        .filter((section) => includeVideo || !section.startsWith('m=video'))
        .join('\n')
}

export class StreamingSession extends Subscribed {
    constructor(camera, connection) {
        super()
        this.camera = camera
        this.connection = connection
        this.onCallEnded = new ReplaySubject(1)
        this.onUsingOpus = new ReplaySubject(1)
        this.onVideoRtp = new Subject()
        this.onAudioRtp = new Subject()
        this.audioSplitter = new RtpSplitter()
        this.videoSplitter = new RtpSplitter()
        this.cameraSpeakerActivated = false
        this.hasEnded = false
        this.bindToConnection(connection)
    }

    bindToConnection(connection) {
        this.addSubscriptions(connection.onAudioRtp.subscribe(this.onAudioRtp), connection.onVideoRtp.subscribe(this.onVideoRtp), connection.onCallAnswered.subscribe((sdp) => {
            this.onUsingOpus.next(sdp.toLocaleLowerCase().includes(' opus/'))
        }), connection.onCallEnded.subscribe(() => this.callEnded()))
    }
    /**
     * @deprecated
     * activate will be removed in the future. Please use requestKeyFrame if you want to explicitly request an initial key frame
     */

    activate() {
        this.requestKeyFrame()
    }

    async reservePort(bufferPorts = 0) {
        const ports = await reservePorts({ count: bufferPorts + 1 })
        return ports[0]
    }

    get isUsingOpus() {
        return firstValueFrom(this.onUsingOpus)
    }

    async startTranscoding(ffmpegOptions) {
        if (this.hasEnded) {
            return
        }
        const videoPort = await this.reservePort(1), audioPort = await this.reservePort(1), transcodeVideoStream = ffmpegOptions.video !== false, ringSdp = await Promise.race([
            firstValueFrom(this.connection.onCallAnswered),
            firstValueFrom(this.onCallEnded),
        ])
        if (!ringSdp) {
            // Call ended before answered'
            return
        }
        const usingOpus = await this.isUsingOpus, ffmpegInputArguments = [
            '-hide_banner',
            '-protocol_whitelist',
            'pipe,udp,rtp,file,crypto',
            // Ring will answer with either opus or pcmu
            ...(usingOpus ? ['-acodec', 'libopus'] : []),
            '-f',
            'sdp',
            ...(ffmpegOptions.input || []),
            '-i',
            'pipe:',
        ], inputSdp = getCleanSdp(ringSdp, transcodeVideoStream)
            .replace(/m=audio \d+/, `m=audio ${audioPort}`)
            .replace(/m=video \d+/, `m=video ${videoPort}`), ff = new FfmpegProcess({
            ffmpegArgs: ffmpegInputArguments.concat(...(ffmpegOptions.audio || ['-acodec', 'aac']), ...(transcodeVideoStream
                ? ffmpegOptions.video || ['-vcodec', 'copy']
                : []), ...(ffmpegOptions.output || [])),
            ffmpegPath: pathToFfmpeg,
            exitCallback: () => this.callEnded(),
            logLabel: `From Ring (${this.camera.name})`,
        })
        this.addSubscriptions(this.onAudioRtp
            .pipe(concatMap((rtp) => {
            return this.audioSplitter.send(rtp.serialize(), {
                port: audioPort,
            })
        }))
            .subscribe())
        if (transcodeVideoStream) {
            this.addSubscriptions(this.onVideoRtp
                .pipe(concatMap((rtp) => {
                return this.videoSplitter.send(rtp.serialize(), {
                    port: videoPort,
                })
            }))
                .subscribe())
        }
        this.onCallEnded.pipe(take(1)).subscribe(() => ff.stop())
        ff.writeStdin(inputSdp)
        // Request a key frame now that ffmpeg is ready to receive
        this.requestKeyFrame()
    }

    callEnded() {
        if (this.hasEnded) {
            return
        }
        this.hasEnded = true
        this.unsubscribe()
        this.onCallEnded.next()
        this.connection.stop()
        this.audioSplitter.close()
        this.videoSplitter.close()
    }

    stop() {
        this.callEnded()
    }

    requestKeyFrame() {
        this.connection.requestKeyFrame()
    }
}
