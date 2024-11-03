// This code is largely copied from ring-client-api, but converted from Typescript
// to native Javascript with custom logging for ring-mqtt and some unused code removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import { parentPort } from 'worker_threads'
import { WebSocket } from 'ws'
import { firstValueFrom, fromEvent, interval, ReplaySubject } from 'rxjs'
import { concatMap, take } from 'rxjs/operators'
import crypto from 'crypto'
import { WeriftPeerConnection } from './peer-connection.js'
import { Subscribed } from './subscribed.js'

export class WebrtcConnection extends Subscribed {
    constructor(ticket, camera) {
        super()
        this.ws = new WebSocket(
            `wss://api.prod.signalling.ring.devices.a2z.com:443/ws?api_version=4.0&auth_type=ring_solutions&client_id=ring_site-${crypto.randomUUID()}&token=${ticket}`,
            {
                headers: {
                    // This must exist or the socket will close immediately but content does not seem to matter
                    'User-Agent': 'android:com.ringapp'
                }
            }
        )
        this.camera = camera
        this.onSessionId = new ReplaySubject(1)
        this.onOfferSent = new ReplaySubject(1)
        this.sessionId = null
        this.dialogId = crypto.randomUUID()
        this.onCameraConnected = new ReplaySubject(1)
        this.onCallAnswered = new ReplaySubject(1)
        this.onCallEnded = new ReplaySubject(1)
        this.onMessage = new ReplaySubject()
        this.hasEnded = false
        const pc = new WeriftPeerConnection()
        this.pc = pc
        this.onAudioRtp = pc.onAudioRtp
        this.onVideoRtp = pc.onVideoRtp
        this.onWsOpen = fromEvent(this.ws, 'open')
        const onMessage = fromEvent(this.ws, 'message')
        const onError = fromEvent(this.ws, 'error')
        const onClose = fromEvent(this.ws, 'close')

        this.addSubscriptions(
            onMessage.pipe(concatMap((event) => {
                const message = JSON.parse(event.data)
                this.onMessage.next(message)
                return this.handleMessage(message)
            })).subscribe(),

            onError.subscribe((error) => {
                parentPort.postMessage({type: 'log_error', data: error})
                this.callEnded()
            }),

            onClose.subscribe(() => {
                this.callEnded()
            }),

            this.pc.onConnectionState.subscribe((state) => {
                if (state === 'failed') {
                    parentPort.postMessage({type: 'log_error', data: 'WebRTC peer connection failed'})
                    this.callEnded()
                }

                if (state === 'closed') {
                    parentPort.postMessage({type: 'log_info', data: 'WebRTC peer connection closed'})
                    this.callEnded()
                }
            }),

            this.onWsOpen.subscribe(() => {
                parentPort.postMessage({type: 'log_info', data: 'Websocket signaling for WebRTC session connected successfully'})
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
            case 'notification': {
                const { text } = message.body
                if (text === 'camera_connected') {
                    this.onCameraConnected.next()
                    return
                } else if (
                    text === 'PeerConnectionState::kConnecting' ||
                    text === 'PeerConnectionState::kConnected'
                ) {
                    return
                }
                break
            }
            case 'close':
                this.callEnded()
                return
        }
    }

    sendSessionMessage(method, body = {}) {
        const sendSessionMessage = (sessionId) => {
            const message = {
                body: {
                    ...body,
                    doorbot_id: this.camera.id,
                    session_id: sessionId,
                },
                dialog_id: this.dialogId,
                method
            }
            this.sendMessage(message)
        }
        if (this.sessionId) {
            // Send immediately if we already have a session id
            // This is needed to send `close` before closing the websocket
            sendSessionMessage(this.sessionId)
        } else {
            this.addSubscriptions(
                this.onSessionId.pipe(take(1)).subscribe(sendSessionMessage)
            )
        }
    }

    sendMessage(message) {
        if (this.hasEnded) {
            return
        }
        this.ws.send(JSON.stringify(message))
    }

    activate() {
        // the activate_session message is required to keep the stream alive longer than 70 seconds
        this.sendSessionMessage('activate_session')
        this.sendSessionMessage('stream_options', {
            audio_enabled: true,
            video_enabled: true,
        })
    }

    callEnded() {
        if (this.hasEnded) {
            return
        }
        try {
            this.sendMessage({
                reason: { code: 0, text: '' },
                method: 'close',
            })
            this.ws.close()
        }
        catch {
            // ignore any errors since we are stopping the call
        }
        this.hasEnded = true
        this.unsubscribe()
        this.onCallEnded.next()
        this.pc.close()
    }

    stop() {
        this.callEnded()
    }

    requestKeyFrame() {
        this.pc.requestKeyFrame?.()
    }
}
