// This code is largely copied from ring-client-api, but converted from Typescript
// to straight Javascript and some code not required for ring-mqtt removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import WebSocket from 'ws'
import { parentPort } from 'worker_threads'
import { StreamingConnectionBase } from './streaming-connection-base.js'

function parseLiveCallSession(sessionId) {
    const encodedSession = sessionId.split('.')[1]
    const buff = Buffer.from(encodedSession, 'base64')
    const text = buff.toString('ascii')
    return JSON.parse(text)
}

export class WebrtcConnection extends StreamingConnectionBase {
    constructor(sessionId, camera) {
        const liveCallSession = parseLiveCallSession(sessionId)

        super(new WebSocket(`wss://${liveCallSession.rms_fqdn}:${liveCallSession.webrtc_port}/`, {
            headers: {
                API_VERSION: '3.1',
                API_TOKEN: sessionId,
                CLIENT_INFO: 'Ring/3.49.0;Platform/Android;OS/7.0;Density/2.0;Device/samsung-SM-T710;Locale/en-US;TimeZone/GMT-07:00',
            },
        }))

        this.camera = camera
        this.sessionId = sessionId

        this.addSubscriptions(
            this.onWsOpen.subscribe(() => {
                parentPort.postMessage('Websocket signalling for Ring cloud connected successfully')
            })
        )
    }

    async handleMessage(message) {
        switch (message.method) {
            case 'sdp':
                const answer = await this.pc.createAnswer(message)
                this.sendSessionMessage('sdp', answer)
                this.onCallAnswered.next(message.sdp)
                this.activate()
                return
            case 'ice':
                await this.pc.addIceCandidate({
                    candidate: message.ice,
                    sdpMLineIndex: message.mlineindex,
                })
                return
        }
    }

    sendSessionMessage(method, body = {}) {
        this.sendMessage({
            ...body,
            method,
        })
    }
}
