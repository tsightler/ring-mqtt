const { WebSocket } = require('ws')
const { firstValueFrom, fromEvent } = require('rxjs')
const { concatMap } = require('rxjs/operators')
const { getFfmpegPath } = require('ring-client-api').getFfmpegPath
const { Subscribed } = require('ring-client-api').Subscribed
const { FfmpegProcess, reservePorts } = require('@homebridge/camera-utils')
const { PeerConnection } = require('./peer-connection')

function getCleanSdp(sdp, includeVideo) {
  return sdp
    .split('\nm=')
    .slice(1)
    .map((section) => 'm=' + section)
    .filter((section) => includeVideo || !section.startsWith('m=video'))
    .join('\n')
}

export class LiveCall extends Subscribed {
  constructor(sessionId, cameraName) {
    super()

    const liveCallSession = parseLiveCallSession(sessionId)
    this.pc = new PeerConnection()
    this.ws = new WebSocket(
      `wss://${liveCallSession.rms_fqdn}:${liveCallSession.webrtc_port}/`,
      {
        headers: {
          API_VERSION: '3.1',
          API_TOKEN: sessionId,
          CLIENT_INFO:
            'Ring/3.48.0;Platform/Android;OS/7.0;Density/2.0;Device/samsung-SM-T710;Locale/en-US;TimeZone/GMT-07:00',
        },
      }
    )

    this.onAudioRtp = this.pc.onAudioRtp
    this.onVideoRtp = this.pc.onVideoRtp

    this.onMessage = fromEvent(this.ws, 'message')
    this.onWsOpen = fromEvent(this.ws, 'open')
    const onError = fromEvent(this.ws, 'error'),
      onClose = fromEvent(this.ws, 'close')
    this.addSubscriptions(
      this.onMessage
        .pipe(
          concatMap((message) => {
            return this.handleMessage(
              JSON.parse(message.data)
            )
          })
        )
        .subscribe(),

      this.onWsOpen.subscribe(() => {
        logDebug(`WebSocket connected for ${this.cameraName}`)
      }),

      onError.subscribe((e) => {
        logError(e)
        this.callEnded()
      }),

      onClose.subscribe(() => {
        this.callEnded()
      })
    )
  }

  async handleMessage(message) {
    switch (message.method) {
      case 'sdp':
        const answer = await this.pc.createAnswer(message)

        this.sendMessage({
          method: 'sdp',
          ...answer,
        })

        this.onCallAnswered.next(message.sdp)
        return
      case 'ice':
        await this.pc.addIceCandidate({
          candidate: message.ice,
          sdpMLineIndex: message.mlineindex,
        })
        return
    }
  }

  async reservePort(bufferPorts = 0) {
    const ports = await reservePorts({ count: bufferPorts + 1 })
    return ports[0]
  }

  async startTranscoding(ffmpegOptions) {
    const videoPort = await this.reservePort(1),
      audioPort = await this.reservePort(1),
      transcodeVideoStream = ffmpegOptions.video !== false,
      ffmpegInputArguments = [
        '-hide_banner',
        '-protocol_whitelist',
        'pipe,udp,rtp,file,crypto',
        '-acodec',
        'libopus',
        '-f',
        'sdp',
        ...(ffmpegOptions.input || []),
        '-i',
        'pipe:',
      ],
      ringSdp = await firstValueFrom(this.onCallAnswered),
      inputSdp = getCleanSdp(ringSdp, transcodeVideoStream)
        .replace(/m=audio \d+/, `m=audio ${audioPort}`)
        .replace(/m=video \d+/, `m=video ${videoPort}`),
      ff = new FfmpegProcess({
        ffmpegArgs: ffmpegInputArguments.concat(
          ...(ffmpegOptions.audio || ['-acodec', 'aac']),
          ...(transcodeVideoStream
            ? ffmpegOptions.video || ['-vcodec', 'copy']
            : []),
          ...(ffmpegOptions.output || [])
        ),
        ffmpegPath: getFfmpegPath(),
        exitCallback: () => this.callEnded(),
        logLabel: `From Ring (${this.cameraName})`,
        logger: {
          error: logError,
          info: logDebug,
        },
      })

    this.addSubscriptions(
      this.onAudioRtp
        .pipe(
          concatMap((rtp) => {
            return this.audioSplitter.send(rtp.serialize(), {
              port: audioPort,
            })
          })
        )
        .subscribe()
    )

    if (transcodeVideoStream) {
      this.addSubscriptions(
        this.onVideoRtp
          .pipe(
            concatMap((rtp) => {
              return this.videoSplitter.send(rtp.serialize(), {
                port: videoPort,
              })
            })
          )
          .subscribe()
      )
    }

    this.onCallEnded.subscribe(() => ff.stop())

    ff.writeStdin(inputSdp)

    // Activate the stream now that ffmpeg is ready to receive
    await this.activate()
  }

  activated = false
  async activate() {
    if (this.activated) {
      return
    }
    this.activated = true

    await firstValueFrom(this.onCallAnswered)
    this.sendMessage({ method: 'activate_session' })
    this.sendMessage({
      video_enabled: true,
      audio_enabled: true,
      method: 'stream_options',
    })
  }

  async activateCameraSpeaker() {
    await firstValueFrom(this.onCallAnswered)
    this.sendMessage({
      stealth_mode: false,
      method: 'camera_options',
    })
  }

  sendMessage(message) {
    this.ws.send(JSON.stringify(message))
  }

  callEnded() {
    try {
      this.sendMessage({
        reason: { code: 0, text: '' },
        method: 'close',
      })
      this.ws.close()
    } catch (_) {
      // ignore any errors since we are stopping the call
    }

    this.unsubscribe()
    this.onCallEnded.next()
    this.pc.close()
    this.audioSplitter.close()
    this.videoSplitter.close()
  }

  stop() {
    this.callEnded()
  }

  sendAudioPacket(rtp) {
    this.pc.returnAudioTrack.writeRtp(rtp)
  }
}