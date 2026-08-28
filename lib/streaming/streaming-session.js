// This code is largely copied from ring-client-api, but converted from Typescript
// to native Javascript with custom logging for ring-mqtt and some unused code removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import { parentPort } from 'worker_threads'
import { RtcpSrPacket } from 'werift'
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

// RTP timestamps for video always run on a 90kHz clock, so how far they advance over a
// known stretch of wall clock says whether the camera is producing a usable timeline at
// all.  A stream whose timestamps stand still cannot be given a position by any player,
// however it is repackaged further downstream.
const videoClockRate = 90000

// How long ffmpeg should hold its reorder queue waiting for a missing packet, in ms.  This
// has to exceed the time a retransmission takes to arrive, which is a round trip to Ring's
// media server, so ffmpeg's own 100ms default is far too short.  It only delays a stream
// which is already missing a packet, and the queue is sized to hold what arrives meanwhile.
const reorderDelay = 500
const reorderQueueSize = 2000

// ffmpeg asks for 384KB by default, which the kernel then clamps to net.core.rmem_max,
// commonly 208KB.  A single high resolution key frame can approach that on its own.
const socketBufferSize = 4 * 1024 * 1024

// TEMPORARY diagnostic scaffolding for the stalled stream clock, remove once the cause is
// known.  Set RINGMQTT_VIDEO_TIMING to one of:
//
//   wallclock  ffmpeg replaces the incoming timestamps with packet arrival time, still
//              copying the video, so only the timeline changes and it costs nothing
//   transcode  the video is decoded and re-encoded in the same codec, so the encoder
//              builds a completely fresh timeline, at a large cost in CPU
//   debugts    changes nothing, but makes ffmpeg print the timestamps of every packet as
//              it reads and writes it, which shows directly whether the timeline handed
//              to the muxer advances.  Very noisy, so only for a short deliberate run.
//
// Both deliberately keep the codec the same, so whatever handles it downstream is still
// exercised.  If either makes the clock run, the timestamps arriving from Ring are at
// fault.  If neither does, the timestamps were never the problem.
const videoTimingTest = process.env.RINGMQTT_VIDEO_TIMING

// Without sender reports ffmpeg derives presentation times from a fixed local baseline,
// which climbs smoothly.  Given them, it re-anchors to the sender's NTP clock every time
// one arrives, and any disagreement between the sender's NTP and RTP clocks then shows up
// as the timeline jumping backwards, which the muxer "corrects" by clamping.  Forwarding
// them buys a real time reference and audio to video alignment, so it is kept available,
// but it is off unless asked for because a jumping timeline is much worse than a timeline
// which merely starts at zero.
const forwardSenderReports = process.env.RINGMQTT_RTCP === 'on'

// How many recent sequence numbers to remember when discarding duplicate packets, large
// enough to cover any realistic retransmission delay and far smaller than the point at
// which 16 bit sequence numbers wrap around
const duplicateWindow = 512

// Routine chatter which says nothing about stream quality and must not be counted as if
// it did.  "stopped gracefully" in particular is printed on every normal exit.
const ffmpegQuiet = /Last message repeated|stopped gracefully/

// Each of these means something different about how the stream is arriving, so they are
// counted separately rather than lumped into one number.  Waiting and giving up is a very
// different problem from a packet turning up after its moment has passed.
const rtpWarningKinds = [
    ['maxDelay', /max delay reached/, 'gave up waiting for a missing packet'],
    ['jitterFull', /jitter buffer full/, 'filled the reorder queue'],
    ['tooLate', /dropping old packet received too late/, 'discarded a packet which arrived too late'],
]

// ffmpeg says how many packets it found missing, and since the packets reach it over a
// local UDP socket, a gap it sees which werift did not see means the loss happened on that
// hop, almost always the receive buffer overflowing.  Counts close to the 16 bit wrap are
// how ffmpeg reports a duplicate or reordered packet rather than a real gap, so they are
// tallied separately.
const rtpMissedPackets = /RTP: missed (\d+) packets/
const maxPlausibleGap = 1000

// ffmpeg clamps a timestamp which moves backwards to one tick past the previous packet,
// which flattens the timeline wherever it happens.  It says so for every packet, which is
// far too noisy to log, but the count matters because it is the clearest sign that what is
// reaching the muxer is not a usable timeline.
const nonMonotonicTimestamps = /Non-monotonic DTS|Queue input is backward in time/

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
// ffmpeg reports the output going away as a string of errors, which is exactly what
// happens every time the last RTSP client disconnects and go2rtc closes the connection.
// These are held back like the rest of the banner, so they surface only if ffmpeg goes on
// to exit badly rather than being killed as part of a normal stop.
const ffmpegTeardownNoise = /Broken pipe|Error muxing a packet|Error submitting a packet to the muxer|Task finished with error code|Conversion failed/

const ffmpegHistoryLines = 60
const ffmpegNotable = /error|failed|could not|cannot|invalid|unable|no such|denied|deprecated|unsupported/i
const ffmpegStreamInfo = /Stream #\d+:\d+: Video:/

// Ring does not currently send parameter sets in the SDP, but if it ever does they are
// base64 and long enough to bury the rest of the line
const maxDescriptionLength = 300

// NAL unit types a decoder can begin on: the parameter sets, and the IRAP pictures which
// carry no dependency on anything before them
const startPoints = (isHevc) => isHevc ? [32, 33, 34, 16, 17, 18, 19, 20, 21] : [7, 8, 5]

// The IRAP pictures alone, without the parameter sets which usually accompany them
const keyFrameTypes = (isHevc) => isHevc ? [16, 17, 18, 19, 20, 21] : [5]

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
        this.rtpTimestampLast = null
        this.rtpTimestampSpan = 0
        this.rtpTimestampStartedAt = null
        this.rtpTimestampJumps = 0
        this.rtpTimestampBackwards = 0
        this.largestBackwardsStep = 0
        this.audioTimestampLast = null
        this.audioTimestampBackwards = 0
        this.audioPacketsSent = 0
        this.currentSecond = 0
        this.bytesThisSecond = 0
        this.packetsThisSecond = 0
        this.peakBytesPerSecond = 0
        this.peakPacketsPerSecond = 0
        this.totalBytes = 0
        this.keyFrames = 0
        this.lastKeyFrameAt = null
        this.lastKeyFrameTimestamp = null
        this.keyFrameGaps = []
        this.duplicatePackets = 0
        this.senderReports = 0
        this.rtpWarnings = { maxDelay: 0, jitterFull: 0, tooLate: 0, gaps: 0 }
        this.missedPackets = 0
        this.reorderedPackets = 0
        this.nonMonotonicPackets = 0
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

    // Sender reports carry the mapping between the camera's RTP timestamps and real time,
    // which is what lets ffmpeg build a timeline and line the audio up against the video.
    // Without them each stream simply starts from zero at its own first packet.  They go
    // to the port above the RTP one, which is why the ports are reserved in pairs.
    // Only sender reports are passed on: the rest is of no use here, and an RTCP BYE would
    // tell ffmpeg the stream had ended.
    forwardRtcp(source, splitter, port) {
        if (!forwardSenderReports) {
            return
        }
        this.addSubscriptions(
            source.pipe(concatMap((rtcp) => {
                if (rtcp?.type !== RtcpSrPacket.type) {
                    return Promise.resolve()
                }
                this.senderReports++
                return splitter.send(rtcp.serialize(), { port })
            })).subscribe()
        )
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
    // Accumulated as signed deltas, the way any receiver has to, so that the 32 bit
    // timestamp wrapping and the occasional reordered packet do not distort the total
    trackRtpTimestamp(timestamp) {
        if (!Number.isFinite(timestamp)) {
            return
        }
        if (this.rtpTimestampLast === null) {
            this.rtpTimestampLast = timestamp
            this.rtpTimestampStartedAt = Date.now()
            return
        }
        let delta = (timestamp - this.rtpTimestampLast) >>> 0
        if (delta > 0x80000000) {
            delta -= 0x100000000
        }
        this.rtpTimestampLast = timestamp
        // One corrupt or wildly out of place timestamp would otherwise skew the total by
        // more than the drift being measured, so anything beyond a second of media in a
        // single step is treated as a discontinuity and counted instead of accumulated
        if (Math.abs(delta) > videoClockRate) {
            this.rtpTimestampJumps++
            return
        }
        // Accumulating signed deltas measures the overall rate correctly but hides a
        // timeline which steps backwards and forwards again, which is precisely what makes
        // a player unable to follow it, so those steps are counted in their own right
        if (delta < 0) {
            this.rtpTimestampBackwards++
            this.largestBackwardsStep = Math.max(this.largestBackwardsStep, -delta)
        }
        this.rtpTimestampSpan += delta
    }

    // Audio matters as much as video for a timeline: a player which cannot line the two up
    // has to keep correcting, and MSE in particular needs both to run cleanly forwards
    inspectAudioPacket(rtp) {
        const timestamp = rtp?.header?.timestamp
        if (!Number.isFinite(timestamp)) {
            return true
        }
        if (this.audioTimestampLast !== null) {
            let delta = (timestamp - this.audioTimestampLast) >>> 0
            if (delta > 0x80000000) {
                delta -= 0x100000000
            }
            if (delta < 0) {
                this.audioTimestampBackwards++
            }
        }
        this.audioTimestampLast = timestamp
        this.audioPacketsSent++
        return true
    }

    logRtpTimingSummary() {
        if (this.rtpTimestampStartedAt === null) {
            return
        }
        const elapsed = (Date.now() - this.rtpTimestampStartedAt) / 1000
        const streamSeconds = this.rtpTimestampSpan / videoClockRate
        const drift = elapsed > 0 ? ((streamSeconds - elapsed) / elapsed) * 100 : 0
        this.log(`Video RTP timestamps advanced ${this.rtpTimestampSpan} ticks ` +
            `(${streamSeconds.toFixed(1)}s at ${videoClockRate/1000}kHz) over ${elapsed.toFixed(1)}s of wall clock, ` +
            `${drift >= 0 ? '+' : ''}${drift.toFixed(1)}% drift` +
            `${this.rtpTimestampJumps ? `, ignoring ${this.rtpTimestampJumps} timestamp jumps` : ''}`)
        if (this.audioTimestampBackwards) {
            this.logError(`Ring's audio timestamps stepped backwards ${this.audioTimestampBackwards} times ` +
                `across ${this.audioPacketsSent} packets, which no player can build a timeline from`)
        }
        if (this.rtpTimestampBackwards) {
            // These are the timestamps as Ring sent them, before ffmpeg has touched
            // anything, so this separates a stream which arrives out of presentation order
            // from a timeline ffmpeg has mangled on its own
            this.log(`Ring's own timestamps stepped backwards ${this.rtpTimestampBackwards} times, ` +
                `by up to ${(this.largestBackwardsStep / videoClockRate * 1000).toFixed(0)}ms`)
        }
        if (elapsed > 2 && streamSeconds < elapsed / 2) {
            this.logError('The camera is barely advancing its RTP timestamps, so nothing downstream can build a ' +
                'timeline from this stream, and the problem is in what Ring is sending rather than in how it is repackaged')
        }
    }

    // Every key frame is a burst far larger than the frames around it, so how often they
    // arrive says whether the four second key frame request loop is driving the stream
    // rather than the camera's own encoder settings
    trackKeyFrames(types, timestamp) {
        if (!types.some((type) => keyFrameTypes(this.usingHevc).includes(type))) {
            return
        }
        // One key frame is usually several slices, each its own NAL unit split across many
        // packets, so counting NAL units counts the same picture several times over.  Every
        // NAL unit of a picture carries the same RTP timestamp, which is what separates one
        // key frame from the next.
        if (timestamp === this.lastKeyFrameTimestamp) {
            return
        }
        this.lastKeyFrameTimestamp = timestamp
        const now = Date.now()
        if (this.lastKeyFrameAt) {
            this.keyFrameGaps.push(now - this.lastKeyFrameAt)
        }
        this.lastKeyFrameAt = now
        this.keyFrames++
    }

    // A scene which suddenly changes everywhere, a floodlight coming on for instance, makes
    // the encoder produce far more data for a while.  The peak matters more than the
    // average, because a burst is what overruns a buffer somewhere downstream.
    trackThroughput(bytes) {
        const second = Math.floor(Date.now() / 1000)
        if (second !== this.currentSecond) {
            this.peakBytesPerSecond = Math.max(this.peakBytesPerSecond, this.bytesThisSecond)
            this.peakPacketsPerSecond = Math.max(this.peakPacketsPerSecond, this.packetsThisSecond)
            this.currentSecond = second
            this.bytesThisSecond = 0
            this.packetsThisSecond = 0
        }
        this.bytesThisSecond += bytes
        this.packetsThisSecond++
        this.totalBytes += bytes
    }

    logThroughputSummary() {
        if (!this.peakBytesPerSecond) {
            return
        }
        const elapsed = this.rtpTimestampStartedAt ? (Date.now() - this.rtpTimestampStartedAt) / 1000 : 0
        const mbps = (bytes) => (bytes * 8 / 1000000).toFixed(1)
        this.log(`Video peaked at ${mbps(this.peakBytesPerSecond)} Mbps and ${this.peakPacketsPerSecond} packets ` +
            `in a second${elapsed ? `, averaging ${mbps(this.totalBytes / elapsed)} Mbps` : ''}`)
    }

    inspectVideoPacket(rtp) {
        this.trackRtpTimestamp(rtp?.header?.timestamp)
        this.trackThroughput((rtp?.payload?.length ?? 0) + 12)
        const types = nalUnitTypes(rtp.payload, this.usingHevc)
        this.trackKeyFrames(types, rtp?.header?.timestamp)
        if (this.parameterSetsSeen && this.cleanStartFound) {
            this.videoPacketsSent++
            return true
        }

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

    logKeyFrameSummary() {
        if (!this.keyFrameGaps.length) {
            return
        }
        const gaps = [...this.keyFrameGaps].sort((a, b) => a - b)
        const median = gaps[Math.floor(gaps.length / 2)] / 1000
        const shortest = gaps[0] / 1000
        const longest = gaps[gaps.length - 1] / 1000
        this.log(`Received ${this.keyFrames} key frames, one every ${median.toFixed(1)}s on average ` +
            `(shortest ${shortest.toFixed(1)}s, longest ${longest.toFixed(1)}s)`)
    }

    logRtpQualitySummary() {
        this.log(`Forwarded ${this.senderReports} RTCP sender reports to ffmpeg`)
        if (this.duplicatePackets) {
            this.log(`Dropped ${this.duplicatePackets} duplicate packets before ffmpeg`)
        }
        const complaints = rtpWarningKinds
            .filter(([key]) => this.rtpWarnings[key])
            .map(([key, , description]) => `${this.rtpWarnings[key]} times ${description}`)
        if (this.rtpWarnings.gaps) {
            complaints.push(`${this.rtpWarnings.gaps} gaps totalling ${this.missedPackets} packets`)
        }
        if (complaints.length) {
            this.log(`ffmpeg ${complaints.join(', ')}`)
        }
        if (this.missedPackets) {
            // Everything forwarded was received intact from Ring, so a gap ffmpeg sees was
            // introduced on the local socket between the two, not out on the network
            this.logError(`ffmpeg never received ${this.missedPackets} of the ${this.videoPacketsSent} packets ` +
                `sent to it over the local socket, which points at its receive buffer overflowing ` +
                `rather than at anything lost between Ring and here`)
        }
        if (this.reorderedPackets) {
            this.log(`ffmpeg reported ${this.reorderedPackets} duplicate or out of order packets`)
        }
        if (this.nonMonotonicPackets) {
            this.logError(`ffmpeg had to correct ${this.nonMonotonicPackets} timestamps which moved backwards, ` +
                'which flattens the timeline and is the most likely reason a player cannot follow the stream')
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
            // The whole point of the timestamp trace is to read it, so none of the usual
            // filtering or holding back applies while it is switched on
            if (videoTimingTest === 'debugts') {
                this.log(`ffmpeg: ${text}`)
                continue
            }
            if (ffmpegQuiet.test(text)) {
                continue
            }
            const warning = rtpWarningKinds.find(([, pattern]) => pattern.test(text))
            if (warning) {
                this.rtpWarnings[warning[0]]++
                continue
            }
            const missed = rtpMissedPackets.exec(text)
            if (missed) {
                const count = Number(missed[1])
                if (count < maxPlausibleGap) {
                    this.missedPackets += count
                    this.rtpWarnings.gaps++
                } else {
                    this.reorderedPackets++
                }
                continue
            }
            if (nonMonotonicTimestamps.test(text)) {
                this.nonMonotonicPackets++
                continue
            }
            if (decoderStartupNoise.test(text)) {
                this.decoderWarnings++
                continue
            }
            if (!ffmpegTeardownNoise.test(text) && (ffmpegNotable.test(text) || ffmpegStreamInfo.test(text))) {
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

    // TEMPORARY, see the note on videoTimingTest.  Re-encodes into the codec that arrived
    // so the comparison only changes where the timestamps come from.
    testVideoArguments() {
        if (videoTimingTest !== 'transcode') {
            if (videoTimingTest === 'wallclock') {
                this.log('TIMING TEST: copying video but taking timestamps from packet arrival time')
            } else if (videoTimingTest === 'debugts') {
                this.log('TIMING TEST: tracing every packet timestamp, expect a great deal of output')
            }
            return false
        }
        this.log(`TIMING TEST: re-encoding video with ${this.usingHevc ? 'libx265' : 'libx264'} to generate fresh timestamps`)
        return this.usingHevc
            ? ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency', '-x265-params', 'log-level=error']
            : ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency']
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
            // ffmpeg waits only 100ms for a missing packet before giving up and consuming
            // its reorder queue out of order, which corrupts the frame and shows up as the
            // stream stalling and restarting.  A lost packet here is usually recovered by
            // retransmission, but that takes a round trip to Ring's media server and often
            // arrives after ffmpeg has already stopped waiting.  Waiting longer costs
            // nothing while packets arrive in order, since it only applies to filling a
            // gap, and gives the retransmission time to arrive.
            '-max_delay', `${reorderDelay * 1000}`,
            '-reorder_queue_size', `${reorderQueueSize}`,
            // Packets reach ffmpeg over a local UDP socket, and a key frame arrives as a
            // burst far larger than the surrounding frames.  If ffmpeg is busy writing to
            // the RTSP server when one lands, the receive buffer has to hold it or the
            // kernel throws the packets away, which looks like loss that neither end
            // reported.  The kernel caps this at net.core.rmem_max regardless of what is
            // asked for, so this requests comfortably more than it expects to get.
            '-buffer_size', `${socketBufferSize}`,
            // Ring will answer with either opus or pcmu
            ...(usingOpus ? ['-acodec', 'libopus'] : []),
            ...(videoTimingTest === 'wallclock' ? ['-use_wallclock_as_timestamps', '1'] : []),
            ...(videoTimingTest === 'debugts' ? ['-debug_ts'] : []),
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
                ...(this.testVideoArguments() || ffmpegOptions.video || ['-vcodec', 'copy']),
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
                // A bad exit only means something if the session was not already being torn
                // down.  Once the last viewer leaves, go2rtc closes the connection under
                // ffmpeg and it exits complaining about a broken pipe, which is expected.
                if (code && code !== 255 && !this.hasEnded) {
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
        this.forwardRtp(this.onAudioRtp, this.audioBuffer, this.audioSplitter, audioPort, (rtp) => this.inspectAudioPacket(rtp))
        this.forwardRtcp(this.connection.onVideoRtcp, this.videoSplitter, videoPort + 1)
        this.forwardRtcp(this.connection.onAudioRtcp, this.audioSplitter, audioPort + 1)

        // Request a key frame now that ffmpeg is ready to receive
        this.requestKeyFrame()
    }

    callEnded() {
        if (this.hasEnded) {
            return
        }
        this.hasEnded = true
        this.logVideoDiagnostics()
        this.logRtpTimingSummary()
        this.logThroughputSummary()
        this.logKeyFrameSummary()
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
