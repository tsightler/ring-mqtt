// This code is largely copied from ring-client-api, but converted from Typescript
// to native Javascript with custom logging for ring-mqtt and some unused code removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import { parentPort } from 'worker_threads'
import { RTCPeerConnection, RTCRtpCodecParameters, useSdesMid, useTransportWideCC } from 'werift'
import { interval, merge, ReplaySubject, Subject } from 'rxjs'
import { Subscribed } from './subscribed.js'

// werift only ever uses the first STUN server it finds in the iceServers list, all
// others are silently discarded, so listing additional servers provides no fallback.
const ringStunServer = 'stun:stun.kinesisvideo.us-east-1.amazonaws.com:443'

// Codecs and header extensions are built fresh for every peer connection because
// werift mutates them in place, assigning header extension ids and, for any codec
// without an explicit payload type, both the payload type and the rtx apt value.
// A codec fallback retry creates a second peer connection in the same worker, so
// these must not be shared module level objects.
//
// Payload types are assigned explicitly because werift otherwise derives them from
// the position of the codec in the list, including the rtx apt value which it sets
// to "payloadType - 1", so simply reordering the codecs would silently break rtx.
const buildAudioCodecs = () => [
    new RTCRtpCodecParameters({
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
        payloadType: 96,
    }),
    new RTCRtpCodecParameters({
        mimeType: 'audio/PCMU',
        clockRate: 8000,
        channels: 1,
        payloadType: 0,
    }),
]

const videoRtcpFeedback = () => [
    { type: 'transport-cc' },
    { type: 'ccm', parameter: 'fir' },
    { type: 'nack' },
    { type: 'nack', parameter: 'pli' },
    { type: 'goog-remb' },
]

const h264Codec = () => new RTCRtpCodecParameters({
    mimeType: 'video/H264',
    clockRate: 90000,
    payloadType: 98,
    rtcpFeedback: videoRtcpFeedback(),
    parameters: 'packetization-mode=1;profile-level-id=640034;level-asymmetry-allowed=1',
})

const h265Codec = () => new RTCRtpCodecParameters({
    mimeType: 'video/H265',
    clockRate: 90000,
    payloadType: 100,
    rtcpFeedback: videoRtcpFeedback(),
    parameters: 'profile-id=1;level-id=93;tier-flag=0;tx-mode=SRST',
})

const rtxCodec = (payloadType, apt) => new RTCRtpCodecParameters({
    mimeType: 'video/rtx',
    clockRate: 90000,
    payloadType,
    parameters: `apt=${apt}`,
})

// "auto" offers both and lets Ring's negotiation choose.  Naming a single codec instead
// makes the answer unambiguous, which matters because Ring ignores the preference order
// in the offer: a camera which supports H265 may answer with H264 and then send H265 on
// the payload type it only listed as an alternative, and the answer handed to ffmpeg then
// describes a codec which does not match what is on the wire.  A camera which will not
// stream the codec it was offered simply sends nothing, which the caller detects.
// Nothing in the pipeline decodes video, so neither codec needs any special handling
// beyond being negotiated correctly.
export const videoCodecs = ['auto', 'h264', 'h265']

const buildVideoCodecs = (videoCodec) => {
    switch (videoCodec) {
        case 'h264':
            return [h264Codec(), rtxCodec(99, 98)]
        case 'h265':
            return [h265Codec(), rtxCodec(101, 100)]
        default:
            return [h264Codec(), rtxCodec(99, 98), h265Codec()]
    }
}

// werift only uses header extensions which are configured here, so without the
// transport wide congestion control extension the transport-cc feedback advertised
// by the codecs above is never actually sent back to Ring.  These are only applied
// to video because werift numbers extension ids across both lists, which would give
// the same extension a different id in each m-line, and BUNDLE requires that bundled
// m-lines agree on the id used for a given extension.
const buildHeaderExtensions = () => ({
    video: [useSdesMid(), useTransportWideCC()],
})

// The negotiated codec list is Ring's answer with any codec we did not offer filtered
// out, in the order Ring listed them, so the first entry which is not a retransmission
// codec is the one Ring will actually send.  Ring lists alternative codecs in the
// answer alongside the one it selects, so searching the answer SDP for a codec name
// finds codecs which are never used and is not a reliable way to detect this.
const negotiatedCodecName = (transceiver) => {
    const codec = transceiver?.codecs.find((codec) => codec.name.toLowerCase() !== 'rtx')
    return codec ? codec.name.toLowerCase() : null
}

export class WeriftPeerConnection extends Subscribed {
    constructor(options = {}) {
        super()
        this.onAudioRtp = new Subject()
        this.onVideoRtp = new Subject()
        this.onAudioRtcp = new Subject()
        this.onVideoRtcp = new Subject()
        this.onIceCandidate = new Subject()
        this.onConnectionState = new ReplaySubject(1)
        this.onRequestKeyFrame = new Subject()
        this.onVideoCodec = new ReplaySubject(1)
        this.onReceivedVideoCodec = new ReplaySubject(1)
        this.negotiatedVideoCodec = null
        this.offeredVideoCodec = videoCodecs.includes(options.videoCodec) ? options.videoCodec : 'auto'
        const pc = (this.pc = new RTCPeerConnection({
            codecs: {
                audio: buildAudioCodecs(),
                video: buildVideoCodecs(options.videoCodec),
            },
            headerExtensions: buildHeaderExtensions(),
            iceServers: [{ urls: ringStunServer }],
            iceTransportPolicy: 'all',
            // These are only applied when explicitly configured, otherwise the werift
            // defaults are used.  Restricting candidate gathering is useful on hosts
            // with many virtual interfaces (docker/hassio bridges, VPN tunnels) where
            // every address gathers its own candidates with a five second STUN timeout.
            ...(options.icePortRange ? { icePortRange: options.icePortRange } : {}),
            ...(options.iceInterfaceAddresses ? { iceInterfaceAddresses: options.iceInterfaceAddresses } : {}),
            ...(options.hasOwnProperty('iceUseIpv4') ? { iceUseIpv4: options.iceUseIpv4 } : {}),
            ...(options.hasOwnProperty('iceUseIpv6') ? { iceUseIpv6: options.iceUseIpv6 } : {}),
        }))

        // Nothing in ring-mqtt sends return audio so this transceiver only ever receives
        const audioTransceiver = pc.addTransceiver('audio', {
            direction: 'recvonly',
        })

        const videoTransceiver = pc.addTransceiver('video', {
            direction: 'recvonly',
        })

        this.videoTransceiver = videoTransceiver

        audioTransceiver.onTrack.subscribe((track) => {
            track.onReceiveRtp.subscribe((rtp) => {
                this.onAudioRtp.next(rtp)
            })
            track.onReceiveRtcp.subscribe((rtcp) => {
                this.onAudioRtcp.next(rtcp)
            })
        })

        videoTransceiver.onTrack.subscribe((track) => {
            track.onReceiveRtp.subscribe((rtp) => {
                this.onVideoRtp.next(rtp)
            })
            track.onReceiveRtcp.subscribe((rtcp) => {
                this.onVideoRtcp.next(rtcp)
            })
            track.onReceiveRtp.once((rtp) => {
                this.reportReceivedVideoCodec(rtp)
                this.addSubscriptions(merge(this.onRequestKeyFrame, interval(4000)).subscribe(() => {
                    videoTransceiver.receiver
                        .sendRtcpPLI(track.ssrc)
                        .catch(() => {
                            // key frame requests are best effort only
                        })
                }))
                this.requestKeyFrame()
            })
        })

        this.pc.onIceCandidate.subscribe((iceCandidate) => {
            if (iceCandidate) {
                this.onIceCandidate.next(iceCandidate)
            }
        })

        pc.iceConnectionStateChange.subscribe(() => {
            if (pc.iceConnectionState === 'closed') {
                this.onConnectionState.next('closed')
            }
        })

        pc.connectionStateChange.subscribe(() => {
            this.onConnectionState.next(pc.connectionState)
        })
    }

    log(message) {
        parentPort?.postMessage({ type: 'log_info', data: message })
    }

    async createOffer() {
        const offer = await this.pc.createOffer()
        await this.pc.setLocalDescription(offer)
        return offer
    }

    async acceptAnswer(answer) {
        await this.pc.setRemoteDescription(answer)
        const negotiatedCodecs = this.videoTransceiver.codecs
        const videoCodec = negotiatedCodecs.find((codec) => codec.name.toLowerCase() !== 'rtx')
        if (videoCodec) {
            const hasRtx = negotiatedCodecs.some((codec) => codec.name.toLowerCase() === 'rtx')
            const alternates = negotiatedCodecs
                .filter((codec) => codec !== videoCodec && codec.name.toLowerCase() !== 'rtx')
                .map((codec) => codec.name)
            this.log(`Ring answered with video codec ${videoCodec.name} (payload type ${videoCodec.payloadType})${hasRtx ? ' with rtx' : ''}` +
                `${alternates.length ? `, also offering unused ${alternates.join('/')}` : ''}`)
        }
        this.negotiatedVideoCodec = negotiatedCodecName(this.videoTransceiver)
        this.onVideoCodec.next(this.negotiatedVideoCodec)
    }

    // Which codec the camera is really sending, taken from the payload type of the first
    // video packet.  Some cameras negotiate one codec and then send another using the
    // payload type of a codec they only listed as an alternative.  werift accepts those
    // packets because the payload type is in the negotiated set, but ffmpeg discards them
    // because the answer SDP describes the m-line as the codec that was negotiated.
    reportReceivedVideoCodec(rtp) {
        const payloadType = rtp?.header?.payloadType
        const codec = this.videoTransceiver.codecs.find((codec) => codec.payloadType === payloadType)
        const receivedCodec = codec ? codec.name.toLowerCase() : null
        if (receivedCodec && this.negotiatedVideoCodec && receivedCodec !== this.negotiatedVideoCodec) {
            this.log(`Camera negotiated ${this.negotiatedVideoCodec.toUpperCase()} but is sending ` +
                `${receivedCodec.toUpperCase()} on payload type ${payloadType}`)
        }
        this.onReceivedVideoCodec.next(receivedCodec)
    }

    addIceCandidate(candidate) {
        return this.pc.addIceCandidate(candidate)
    }

    requestKeyFrame() {
        this.onRequestKeyFrame.next()
    }

    async logStats() {
        try {
            const summary = []
            for (const stat of (await this.pc.getStats()).values()) {
                if (stat.type === 'inbound-rtp') {
                    summary.push(`${stat.kind} received ${stat.packetsReceived ?? 0} packets, ` +
                        `lost ${stat.packetsLost ?? 0}, nack ${stat.nackCount ?? 0}, pli ${stat.pliCount ?? 0}`)
                }
            }
            if (summary.length) {
                this.log(`WebRTC session statistics: ${summary.join(' | ')}`)
            }
        } catch {
            // statistics are informational only and must never interfere with teardown
        }
    }

    async close() {
        // Unsubscribe first so the key frame request interval stops before teardown
        this.unsubscribe()
        await this.logStats()
        try {
            await this.pc.close()
        } catch (error) {
            this.log(`Error while closing WebRTC peer connection: ${error.message}`)
        }
    }
}
