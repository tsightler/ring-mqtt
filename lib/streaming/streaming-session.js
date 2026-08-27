// This code is largely copied from ring-client-api, but converted from Typescript
// to native Javascript with custom logging for ring-mqtt and some unused code removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import { parentPort } from 'worker_threads'
import { FfmpegProcess, reservePorts, RtpSplitter } from '@homebridge/camera-utils'
import { firstValueFrom, ReplaySubject, Subject } from 'rxjs'
import pathToFfmpeg from 'ffmpeg-for-homebridge'
import { concatMap, take } from 'rxjs/operators'
import { Subscribed } from './subscribed.js'

// Video packets received before ffmpeg is ready are held rather than dropped, because
// the first packets of the stream carry the H.264/H.265 parameter sets which ffmpeg
// needs to determine the frame size.  Ring does not resend them in response to a key
// frame request, so losing them means ffmpeg can never write its output header and the
// stream dies with "dimensions not set".  The cap is generous enough to cover a slow
// ffmpeg start while bounding memory if transcoding never begins at all.
const maxBufferedRtpPackets = 1024

// ffmpeg cannot determine the frame size, and so cannot write its output header, unless
// the video stream carries parameter sets (SPS and PPS for H.264, VPS/SPS/PPS for
// H.265).  Sampling the NAL unit types at the start of the stream shows whether the
// camera actually sends them, which separates a stream problem from a codec problem.
const videoDiagnosticPackets = 200

// How many recent sequence numbers to remember when discarding duplicate packets, large
// enough to cover any realistic retransmission delay and far smaller than the point at
// which 16 bit sequence numbers wrap around
const duplicateWindow = 512

// ffmpeg reports every reordered, duplicated or missing RTP packet individually, which
// runs to hundreds of lines on a busy stream, so these are counted and reported once
const rtpNoise = /jitter buffer full|RTP: missed \d+ packets|dropping old packet received too late|max delay reached|Last message repeated|stopped gracefully/

// Cameras do not necessarily send parameter sets at the start of the stream, so until the
// first set arrives every frame is undecodable and the decoder says so for each one.  This
// is normal during startup and only worth reporting as a count, but "Could not find codec
// parameters" is deliberately not matched here since that one means the stream never
// became decodable at all.
const decoderStartupNoise = /(SPS|PPS|VPS) \d+ does not exist|PPS id out of range|Skipping invalid undecodable NALU|non-existing PPS|Error parsing NAL unit/

// ffmpeg's startup banner runs to well over a dozen lines of stream, mapping and encoder
// detail which is only worth reading when something has gone wrong, so it is held back
// and released only if the stream fails.  Anything that reports a problem, and the video
// stream description which is useful on its own, are logged as they arrive.
const ffmpegHistoryLines = 60
const ffmpegNotable = /error|failed|could not|cannot|invalid|unable|no such|denied|deprecated|unsupported/i
const ffmpegStreamInfo = /Stream #\d+:\d+: Video:/

// Ring does not currently send parameter sets in the SDP, but if it ever does they are
// base64 and long enough to bury the rest of the line
const maxDescriptionLength = 300

// NAL unit types a decoder can begin on: the parameter sets, and the IRAP pictures which
// carry no dependency on anything before them
const startPoints = (isHevc) => isHevc ? [32, 33, 34, 16, 17, 18, 19, 20, 21] : [7, 8, 5]

// How long to look for one before giving up and forwarding whatever is arriving, so that
// a camera which never sends a recognisable start point still produces a stream
const maxLeadingPackets = 300

const h264NalNames = { 1: 'non-IDR', 5: 'IDR', 6: 'SEI', 7: 'SPS', 8: 'PPS', 9: 'AUD' }
const h265NalNames = { 1: 'non-IDR', 19: 'IDR', 20: 'IDR', 32: 'VPS', 33: 'SPS', 34: 'PPS', 39: 'SEI' }

// Returns the NAL unit types carried by one RTP payload, unwrapping the aggregation and
// fragmentation packet formats so that a parameter set split across packets still shows
function nalUnitTypes(payload, isHevc) {
    const types = []
    if (!payload?.length) {
        return types
    }
    if (isHevc) {
        const type = (payload[0] >> 1) & 0x3f
        if (type === 48) { // aggregation packet
            let offset = 2
            while (offset + 2 <= payload.length) {
                const size = payload.readUInt16BE(offset)
                offset += 2
                if (!size || offset + size > payload.length) { break }
                types.push((payload[offset] >> 1) & 0x3f)
                offset += size
            }
        } else if (type === 49) { // fragmentation unit, only the first fragment names the type
            if (payload.length > 2 && payload[2] & 0x80) { types.push(payload[2] & 0x3f) }
        } else {
            types.push(type)
        }
        return types
    }
    const type = payload[0] & 0x1f
    if (type === 24) { // single time aggregation packet
        let offset = 1
        while (offset + 2 <= payload.length) {
            const size = payload.readUInt16BE(offset)
            offset += 2
            if (!size || offset + size > payload.length) { break }
            types.push(payload[offset] & 0x1f)
            offset += size
        }
    } else if (type === 28) { // fragmentation unit
        if (payload.length > 1 && payload[1] & 0x80) { types.push(payload[1] & 0x1f) }
    } else {
        types.push(type)
    }
    return types
}

// A sender which does not repeat parameter sets in the stream is expected to supply them
// out of band as sprop-vps/sprop-sps/sprop-pps on the fmtp line, so when the stream turns
// out to be undecodable the first thing worth knowing is what Ring actually described
function getVideoDescription(sdp) {
    const section = sdp.split(/\r?\nm=/).find((part) => part.replace(/^m=/, '').startsWith('video'))
    if (!section) {
        return 'no video media section'
    }
    const attributes = section.split(/\r?\n/).filter((line) => /^a=(rtpmap|fmtp):/.test(line))
    if (!attributes.length) {
        return 'no codec attributes'
    }
    const description = attributes.join(' | ')
    return description.length > maxDescriptionLength
        ? `${description.slice(0, maxDescriptionLength)}...`
        : description
}

function getCleanSdp(sdp) {
    return sdp
        .split('\nm=')
        .slice(1)
        .map((section) => 'm=' + section)
        .join('\n')
}

export class StreamingSession extends Subscribed {
    constructor(camera, connection) {
        super()
        this.camera = camera
        this.connection = connection
        this.onCallEnded = new ReplaySubject(1)
        this.onUsingOpus = new ReplaySubject(1)
        this.onUsingHevc = new ReplaySubject(1)
        this.onVideoRtp = new Subject()
        this.onAudioRtp = new Subject()
        this.audioSplitter = new RtpSplitter()
        this.videoSplitter = new RtpSplitter()
        this.hasEnded = false
        this.bufferingRtp = true
        this.videoBuffer = []
        this.audioBuffer = []
        this.usingHevc = false
        this.videoPacketsSent = 0
        this.videoNalTypes = new Set()
        this.videoDiagnosticsLogged = false
        this.parameterSetsSeen = false
        this.parameterSetsAfter = 0
        this.cleanStartFound = false
        this.leadingPackets = 0
        this.startedWith = []
        this.ffmpegOutput = ''
        this.ffmpegHistory = []
        this.ffmpegHistoryLogged = false
        this.duplicatePackets = 0
        this.rtpWarnings = 0
        this.decoderWarnings = 0
        this.bindToConnection(connection)
    }

    bindToConnection(connection) {
        this.addSubscriptions(
            connection.onAudioRtp.subscribe(this.onAudioRtp),
            connection.onVideoRtp.subscribe(this.onVideoRtp),
            this.onVideoRtp.subscribe((rtp) => this.bufferRtp(this.videoBuffer, rtp)),
            this.onAudioRtp.subscribe((rtp) => this.bufferRtp(this.audioBuffer, rtp)),
            connection.onCallAnswered.subscribe((sdp) => {
                this.onUsingOpus.next(sdp.toLocaleLowerCase().includes(' opus/'))
            }),
            // Taken from the negotiated codec rather than the answer SDP, since Ring
            // lists alternative video codecs in the answer which it never sends
            connection.onVideoCodec.subscribe((codec) => {
                this.usingHevc = codec === 'h265'
                this.onUsingHevc.next(this.usingHevc)
            }),
            connection.onCallEnded.subscribe(() => this.callEnded()))
    }

    async reservePort(bufferPorts = 0) {
        const ports = await reservePorts({ count: bufferPorts + 1 })
        return ports[0]
    }

    get isUsingOpus() {
        return firstValueFrom(this.onUsingOpus)
    }

    get isUsingHevc() {
        return firstValueFrom(this.onUsingHevc)
    }

    bufferRtp(buffer, rtp) {
        // Only the earliest packets are kept, since those are the ones carrying the
        // parameter sets, so a full buffer discards new packets rather than old ones
        if (this.bufferingRtp && buffer.length < maxBufferedRtpPackets) {
            buffer.push(rtp)
        }
    }

    // Sends everything buffered while ffmpeg was starting and then continues with live
    // packets.  Draining and subscribing happen in the same synchronous block so that
    // no packet can slip through the gap or be sent twice, and concatMap keeps them in
    // order regardless of how long an individual send takes.
    // Retransmitted packets are unwrapped and emitted alongside the originals whenever
    // both arrive, and a duplicate carries nothing new, so it is dropped here instead of
    // being left to take up room in ffmpeg's reorder queue
    createDuplicateFilter() {
        const seen = new Set()
        const order = []
        return (sequenceNumber) => {
            if (seen.has(sequenceNumber)) {
                return true
            }
            seen.add(sequenceNumber)
            order.push(sequenceNumber)
            if (order.length > duplicateWindow) {
                seen.delete(order.shift())
            }
            return false
        }
    }

    forwardRtp(source, buffer, splitter, port, inspect) {
        const packets = new Subject()
        const isDuplicate = this.createDuplicateFilter()
        this.addSubscriptions(
            packets.pipe(concatMap((rtp) => {
                if (isDuplicate(rtp.header.sequenceNumber)) {
                    this.duplicatePackets++
                    return Promise.resolve()
                }
                if (inspect && !inspect(rtp)) {
                    return Promise.resolve()
                }
                return splitter.send(rtp.serialize(), { port })
            })).subscribe()
        )
        for (const rtp of buffer) {
            packets.next(rtp)
        }
        buffer.length = 0
        this.addSubscriptions(source.subscribe((rtp) => packets.next(rtp)))
    }

    get missingParameterSets() {
        const parameterSets = this.usingHevc ? [32, 33, 34] : [7, 8]
        return parameterSets.filter((type) => !this.videoNalTypes.has(type))
    }

    describeNalTypes(types) {
        const names = this.usingHevc ? h265NalNames : h264NalNames
        return types.map((type) => `${names[type] || 'type'}(${type})`).join(' ')
    }

    // Cameras do not always send parameter sets at the start of the stream, and nothing is
    // decodable until they arrive, so this keeps watching for the whole session rather than
    // sampling only the beginning and mistaking a slow start for a broken stream
    inspectVideoPacket(rtp) {
        if (this.parameterSetsSeen && this.cleanStartFound) {
            this.videoPacketsSent++
            return true
        }
        const types = nalUnitTypes(rtp.payload, this.usingHevc)

        // Video is copied through untouched, so whatever is forwarded first is what the
        // downstream player tries to decode first.  Starting part way through a frame hands
        // it an incomplete access unit and it shows the result, so leading packets are
        // dropped until the stream reaches a point a decoder can actually start from.  If
        // no such point turns up the stream is forwarded anyway rather than never starting.
        if (!this.cleanStartFound) {
            this.leadingPackets++
            if (types.some((type) => startPoints(this.usingHevc).includes(type))) {
                this.cleanStartFound = true
                this.startedWith = types
                if (this.leadingPackets > 1) {
                    this.log(`Dropped ${this.leadingPackets - 1} leading packets to start on ${this.describeNalTypes(types)}`)
                }
            } else if (this.leadingPackets >= maxLeadingPackets) {
                this.cleanStartFound = true
                this.startedWith = types
                this.log(`No frame start found in ${this.leadingPackets} packets, forwarding from ` +
                    `${this.describeNalTypes(types) || 'an unrecognised packet'} anyway`)
            } else {
                return false
            }
        }

        this.videoPacketsSent++
        if (this.parameterSetsSeen) {
            return true
        }
        for (const type of types) {
            this.videoNalTypes.add(type)
        }
        if (!this.missingParameterSets.length) {
            this.parameterSetsSeen = true
            this.parameterSetsAfter = this.videoPacketsSent
            this.log(`Video stream became decodable after ${this.videoPacketsSent} packets, ` +
                `starting with ${this.describeNalTypes(this.startedWith)}`)
        } else if (this.videoPacketsSent === videoDiagnosticPackets) {
            this.log(`Still waiting for ${this.describeNalTypes(this.missingParameterSets)} after ` +
                `${this.videoPacketsSent} video packets, nothing decodes until the camera sends them`)
        }
        return true
    }

    logVideoDiagnostics() {
        if (this.videoDiagnosticsLogged || !this.videoPacketsSent) {
            return
        }
        this.videoDiagnosticsLogged = true
        if (this.parameterSetsSeen) {
            // NAL types are only sampled until the stream becomes decodable, so listing
            // them here would look like the whole stream contained nothing but parameter
            // sets.  What matters by this point is how long they took to arrive.
            this.log(`Forwarded ${this.videoPacketsSent} video packets to ffmpeg, ` +
                `parameter sets arrived after ${this.parameterSetsAfter}`)
            return
        }
        const seen = this.describeNalTypes([...this.videoNalTypes].sort((a, b) => a - b))
        this.log(`Forwarded ${this.videoPacketsSent} video packets to ffmpeg, NAL units seen: ${seen || 'none'}`)
        this.logError(`The video stream never carried ${this.describeNalTypes(this.missingParameterSets)}, ` +
            'so it was never decodable')
        this.logFfmpegHistory()
    }

    logRtpQualitySummary() {
        if (this.duplicatePackets || this.rtpWarnings) {
            this.log(`Dropped ${this.duplicatePackets} duplicate packets before ffmpeg, ` +
                `and ffmpeg reported ${this.rtpWarnings} reordered or missing packet warnings`)
        }
        if (this.decoderWarnings) {
            this.log(`ffmpeg discarded ${this.decoderWarnings} undecodable frames while waiting for the camera to send parameter sets`)
        }
    }

    // ffmpeg output arrives in arbitrary chunks which regularly split a message across two
    // of them, so anything after the last newline is held back until the rest turns up
    logFfmpegOutput(log) {
        const lines = (this.ffmpegOutput + log.toString()).split(/\r?\n|\r/)
        this.ffmpegOutput = lines.pop()
        for (const line of lines) {
            const text = line.trim()
            if (!text || /^(frame|size)=/.test(text)) {
                continue
            }
            if (rtpNoise.test(text)) {
                this.rtpWarnings++
                continue
            }
            if (decoderStartupNoise.test(text)) {
                this.decoderWarnings++
                continue
            }
            if (ffmpegNotable.test(text) || ffmpegStreamInfo.test(text)) {
                this.log(`ffmpeg: ${text}`)
                continue
            }
            this.ffmpegHistory.push(text)
            if (this.ffmpegHistory.length > ffmpegHistoryLines) {
                this.ffmpegHistory.shift()
            }
        }
    }

    // Released when a stream fails, so that the detail needed to work out why is there
    // without it being logged on every successful stream
    logFfmpegHistory() {
        if (this.ffmpegHistoryLogged || !this.ffmpegHistory.length) {
            return
        }
        this.ffmpegHistoryLogged = true
        this.log(`Last ${this.ffmpegHistory.length} lines of ffmpeg output before the failure:`)
        for (const line of this.ffmpegHistory) {
            this.log(`ffmpeg: ${line}`)
        }
    }

    log(message) {
        parentPort?.postMessage({ type: 'log_info', data: message })
    }

    logError(message) {
        parentPort?.postMessage({ type: 'log_error', data: message })
    }

    async startTranscoding(ffmpegOptions) {
        if (this.hasEnded) {
            return
        }
        const videoPort = await this.reservePort(1)
        const audioPort = await this.reservePort(1)

        const ringSdp = await Promise.race([
            firstValueFrom(this.connection.onCallAnswered),
            firstValueFrom(this.onCallEnded),
        ])

        if (!ringSdp) {
            // Call ended before answered'
            return
        }
        this.log(`Ring described the video stream as: ${getVideoDescription(ringSdp)}`)
        const usingOpus = await this.isUsingOpus

        const ffmpegInputArguments = [
            '-hide_banner',
            '-protocol_whitelist',
            'pipe,udp,rtp,file,crypto',
            // Ring will answer with either opus or pcmu
            ...(usingOpus ? ['-acodec', 'libopus'] : []),
            '-f',
            'sdp',
            ...(ffmpegOptions.input || []),
            '-i',
            'pipe:'
        ]

        const inputSdp = getCleanSdp(ringSdp)
            .replace(/m=audio \d+/, `m=audio ${audioPort}`)
            .replace(/m=video \d+/, `m=video ${videoPort}`)

        const ff = new FfmpegProcess({
            ffmpegArgs: ffmpegInputArguments.concat(
                ...(ffmpegOptions.audio || ['-acodec', 'aac']),
                ...(ffmpegOptions.video || ['-vcodec', 'copy']),
                ...(ffmpegOptions.output || [])),
            ffmpegPath: pathToFfmpeg,
            // ffmpeg writes everything to stderr, including the periodic progress lines
            // which are far too noisy to keep, but its warnings are often the only
            // explanation for why a stream stopped so they must not be discarded
            logger: {
                info: (log) => this.logFfmpegOutput(log),
                error: (log) => this.logError(`ffmpeg: ${log.toString().trim()}`)
            },
            exitCallback: (code, signal) => {
                this.log(`ffmpeg exited with code ${code}${signal ? ` on signal ${signal}` : ''}`)
                // A null code with a signal is the normal stop, anything else is a failure
                // worth seeing the output for
                if (code && code !== 255) {
                    this.logFfmpegHistory()
                }
                this.callEnded()
            }
        })

        this.onCallEnded.pipe(take(1)).subscribe(() => ff.stop())

        // The SDP is written first so that ffmpeg can parse it and bind its RTP sockets
        // before any packets are sent, since anything arriving before it is listening is
        // simply lost and shows up later as a gap in the sequence numbers
        ff.writeStdin(inputSdp)

        // Stop buffering and hand everything held so far to ffmpeg before wiring up the
        // live packets, all without awaiting anything in between
        this.bufferingRtp = false
        if (this.videoBuffer.length || this.audioBuffer.length) {
            this.log(`Sending ${this.videoBuffer.length} buffered video and ${this.audioBuffer.length} buffered audio packets to ffmpeg`)
        }
        this.forwardRtp(this.onVideoRtp, this.videoBuffer, this.videoSplitter, videoPort, (rtp) => this.inspectVideoPacket(rtp))
        this.forwardRtp(this.onAudioRtp, this.audioBuffer, this.audioSplitter, audioPort)

        // Request a key frame now that ffmpeg is ready to receive
        this.requestKeyFrame()
    }

    callEnded() {
        if (this.hasEnded) {
            return
        }
        this.hasEnded = true
        this.logVideoDiagnostics()
        this.logRtpQualitySummary()
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
