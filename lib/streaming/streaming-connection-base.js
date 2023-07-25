// This code is largely copied from ring-client-api, but converted from Typescript
// to native Javascript with custom logging for ring-mqtt and some unused code removed.
// Much thanks to @dgreif for the original code which is the basis for this work.

import { WeriftPeerConnection } from './peer-connection.js'
import { Subscribed } from './subscribed.js'
import { fromEvent, ReplaySubject } from 'rxjs'
import { concatMap } from 'rxjs/operators'

export class StreamingConnectionBase extends Subscribed {
    constructor(ws) {
        super()
        this.ws = ws
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

            onError.subscribe((e) => {
                this.callEnded()
            }),

            onClose.subscribe(() => {
                this.callEnded()
            }),

            this.pc.onConnectionState.subscribe((state) => {
                if (state === 'failed') {
                    this.callEnded()
                }
                if (state === 'closed') {
                    this.callEnded()
                }
            })
        )
    }

    activate() {
        // the activate_session message is required to keep the stream alive longer than 70 seconds
        this.sendSessionMessage('activate_session')
        this.sendSessionMessage('stream_options', {
            audio_enabled: true,
            video_enabled: true,
        })
    }

    sendMessage(message) {
        if (this.hasEnded) {
            return
        }
        this.ws.send(JSON.stringify(message))
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
        catch (_) {
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
