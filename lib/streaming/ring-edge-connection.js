// This code is largely copied from ring-client-api, but converted from Typescript
// to straight Javascript and some code not required for ring-mqtt removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import WebSocket from 'ws'
import { parentPort } from 'worker_threads'
import { firstValueFrom, interval, ReplaySubject } from 'rxjs'
import { StreamingConnectionBase } from './streaming-connection-base.js'
import crypto from 'crypto'

export class RingEdgeConnection extends StreamingConnectionBase {
    constructor(authToken, camera) {
        super(
            new WebSocket('wss://api.prod.signalling.ring.devices.a2z.com:443/ws', {
                headers: {
                    Authorization: `Bearer ${authToken}`,
                    'X-Sig-API-Version': '4.0',
                    'X-Sig-Client-ID': `ring_android-${crypto
                        .randomBytes(4)
                        .toString('hex')}`,
                    'X-Sig-Client-Info': 'Ring/3.60.0;Platform/Android;OS/12;Density/2.75;Device/samsung-SM-T710;Locale/en-US;TimeZone/GMT-07:00',
                    'X-Sig-Auth-Type': 'ring_oauth',
                }
            })
        )

        this.camera = camera
        this.onSessionId = new ReplaySubject(1)
        this.onOfferSent = new ReplaySubject(1)
        this.sessionId = null
        this.dialogId = `${crypto.randomUUID()}-${Math.floor(100000 + Math.random() * 900000)}`

        this.addSubscriptions(
            this.onWsOpen.subscribe(() => {
                parentPort.postMessage({type: 'log_info', data: 'Websocket signalling for Ring Edge connected successfully'})
                this.initiateCall().catch((error) => {
                    parentPort.postMessage({type: 'log_error', data: error})
                    this.callEnded()
                })
            }),

            // The ring-edge session needs a ping every 5 seconds to keep the connection alive
            interval(5000).subscribe(() => {
                this.sendSessionMessage('ping')
            }),

            this.pc.onIceCandidate.subscribe(async (iceCandidate) => {
                await firstValueFrom(this.onOfferSent)
                this.sendMessage({
                    body: {
                        doorbot_id: camera.id,
                        ice: iceCandidate.candidate,
                        mlineindex: iceCandidate.sdpMLineIndex,
                    },
                    dialog_id: this.dialogId,
                    method: 'ice',
                })
            })
        )
    }

    async initiateCall() {
        const { sdp } = await this.pc.createOffer()

        this.sendMessage({
            body: {
                doorbot_id: this.camera.id,
                stream_options: { audio_enabled: true, video_enabled: true },
                sdp,
            },
            dialog_id: this.dialogId,
            method: 'live_view'
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
            !this.sessionId
        ) {
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
                body: {
                    ...body,
                    doorbot_id: this.camera.id,
                    session_id: this.sessionId,
                },
                dialog_id: this.dialogId,
                method
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
                    // debug(e)
                })
        }
    }
}
