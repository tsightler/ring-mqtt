import WebSocket from 'ws'
import { parentPort } from 'worker_threads'
import { firstValueFrom, interval, ReplaySubject } from 'rxjs'
import { StreamingConnectionBase, } from './streaming-connection-base.js'
import crypto from 'crypto'

var CloseReasonCode

(function (CloseReasonCode) {
    CloseReasonCode[CloseReasonCode["NormalClose"] = 0] = "NormalClose"
    // reason: { code: 5, text: '[rsl-apps/webrtc-liveview-server/Session.cpp:429] [Auth] [0xd540]: [rsl-apps/session-manager/Manager.cpp:227] [AppAuth] Unauthorized: invalid or expired token' }
    // reason: { code: 5, text: 'Authentication failed: -1' }
    // reason: { code: 5, text: 'Sessions with the provided ID not found' }
    CloseReasonCode[CloseReasonCode["AuthenticationFailed"] = 5] = "AuthenticationFailed"
    // reason: { code: 6, text: 'Timeout waiting for ping' }
    CloseReasonCode[CloseReasonCode["Timeout"] = 6] = "Timeout"
})(CloseReasonCode || (CloseReasonCode = {}))

export class RingEdgeConnection extends StreamingConnectionBase {
    constructor(authToken, camera) {
        super(new WebSocket('wss://api.prod.signalling.ring.devices.a2z.com:443/ws', {
            headers: {
                Authorization: `Bearer ${authToken}`,
                'X-Sig-API-Version': '4.0',
                'X-Sig-Client-ID': `ring_android-${crypto
                    .randomBytes(4)
                    .toString('hex')}`,
                'X-Sig-Client-Info': 'Ring/3.49.0;Platform/Android;OS/7.0;Density/2.0;Device/samsung-SM-T710;Locale/en-US;TimeZone/GMT-07:00',
                'X-Sig-Auth-Type': 'ring_oauth',
            },
        }))

        this.camera = camera
        this.onSessionId = new ReplaySubject(1)
        this.onOfferSent = new ReplaySubject(1)
        this.sessionId = null

        this.addSubscriptions(this.onWsOpen.subscribe(() => {
            parentPort.postMessage('Ring Edge websocket signalling connection established')
            this.initiateCall().catch((error) => {
                parentPort.postMessage(error)
                this.callEnded()
            })
        }), 
        // The ring-edge session needs a ping every 5 seconds to keep the connection alive
        interval(5000).subscribe(() => {
            this.sendSessionMessage('ping')
        }), this.pc.onIceCandidate.subscribe(async (iceCandidate) => {
            await firstValueFrom(this.onOfferSent)
            this.sendMessage({
                method: 'ice',
                body: {
                    doorbot_id: camera.id,
                    ice: iceCandidate.candidate,
                    mlineindex: iceCandidate.sdpMLineIndex,
                },
            })
        }))
    }
    async initiateCall() {
        const { sdp } = await this.pc.createOffer()
        this.sendMessage({
            method: 'live_view',
            body: {
                doorbot_id: this.camera.id,
                stream_options: { audio_enabled: true, video_enabled: true },
                sdp,
            },
        })
        this.onOfferSent.next()
    }
    async handleMessage(message) {
        if (message.body.doorbot_id !== this.camera.id) {
            // ignore messages for other cameras
            return
        }
        if (['session_created', 'session_started'].includes(message.method) &&
            'session_id' in message.body &&
            !this.sessionId) {
            this.sessionId = message.body.session_id
            this.onSessionId.next(this.sessionId)
        }
        if (message.body.session_id && message.body.session_id !== this.sessionId) {
            // ignore messages for other sessions
            return
        }
        switch (message.method) {
            case 'session_created':
            case 'session_started':
                // session already stored above
                return
            case 'sdp':
                await this.pc.acceptAnswer(message.body)
                this.onCallAnswered.next(message.body.sdp)
                this.activate()
                return
            case 'ice':
                await this.pc.addIceCandidate({
                    candidate: message.body.ice,
                    sdpMLineIndex: message.body.mlineindex,
                })
                return
            case 'pong':
                return
            case 'notification':
                const { text } = message.body
                if (text === 'PeerConnectionState::kConnecting' ||
                    text === 'PeerConnectionState::kConnected') {
                    return
                }
                break
            case 'close':
                this.callEnded()
                return
        }
    }

    sendSessionMessage(method, body = {}) {
        const sendSessionMessage = () => {
            const message = {
                method,
                body: {
                    ...body,
                    doorbot_id: this.camera.id,
                    session_id: this.sessionId,
                },
            }
            this.sendMessage(message)
        }
        if (this.sessionId) {
            // Send immediately if we already have a session id
            // This is needed to send `close` before closing the websocket
            sendSessionMessage()
        }
        else {
            firstValueFrom(this.onSessionId)
                .then(sendSessionMessage)
                .catch((e) => { 
                    //debug(e) 
                })
        }
    }
}
