// ringstream terminates a Ring WebRTC live stream and republishes it to an
// RTSP server, replacing the werift + ffmpeg pipeline. RTP is passed through
// untouched, so Ring's own timestamps survive end to end.
package main

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtcp"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var ringICEServers = []string{
	"stun:stun.kinesisvideo.us-east-1.amazonaws.com:443",
	"stun:stun.kinesisvideo.us-east-2.amazonaws.com:443",
	"stun:stun.kinesisvideo.us-west-2.amazonaws.com:443",
	"stun:stun.l.google.com:19302",
	"stun:stun1.l.google.com:19302",
	"stun:stun2.l.google.com:19302",
	"stun:stun3.l.google.com:19302",
	"stun:stun4.l.google.com:19302",
}

func newPeerConnection(videoCodec, h265Fmtp string) (*webrtc.PeerConnection, error) {
	m := &webrtc.MediaEngine{}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypeOpus,
			ClockRate: 48000,
			Channels:  2,
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:  webrtc.MimeTypePCMU,
			ClockRate: 8000,
			Channels:  1,
		},
		PayloadType: 0,
	}, webrtc.RTPCodecTypeAudio); err != nil {
		return nil, err
	}

	// Advertise the same feedback types werift did. What actually matters is
	// that no TWCC feedback is ever sent; see the interceptor registration below.
	feedback := []webrtc.RTCPFeedback{
		{Type: "ccm", Parameter: "fir"},
		{Type: "nack"},
		{Type: "nack", Parameter: "pli"},
		{Type: "transport-cc"},
		{Type: "goog-remb"},
	}

	// Only the wanted codec is offered, since Ring answers within whatever the
	// offer contains. Offering H.264 alone is what has always made Ring transcode
	// to it, at the cost of quality on cameras that encode HEVC natively.
	videoMime := webrtc.MimeTypeH264
	fmtpLine := "packetization-mode=1;profile-level-id=640034;level-asymmetry-allowed=1"
	if videoCodec == "h265" {
		videoMime = webrtc.MimeTypeH265
		// Ask Ring for 8 bit Main rather than letting it choose. Cameras that
		// encode Main 10 cannot be relayed: the RTSP server's HEVC parser
		// handles only general_profile_idc == 1, so it advertises no profile to
		// the browser, which then defaults to Main and hands 10 bit data to an
		// 8 bit hardware decoder. That fails with no software fallback.
		fmtpLine = h265Fmtp
	}

	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:     videoMime,
			ClockRate:    90000,
			SDPFmtpLine:  fmtpLine,
			RTCPFeedback: feedback,
		},
		PayloadType: 96,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}

	// werift offered RTX; without it Ring cannot retransmit lost packets to us,
	// and a sender that cannot repair loss tends to shed resolution instead.
	if err := m.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    "video/rtx",
			ClockRate:   90000,
			SDPFmtpLine: "apt=96",
		},
		PayloadType: 97,
	}, webrtc.RTPCodecTypeVideo); err != nil {
		return nil, err
	}

	// The offer advertises nack, transport-cc and goog-remb, but pion only
	// actually sends receiver reports, NACKs and congestion control feedback when
	// the default interceptors are registered. Without them Ring's encoder gets no
	// bandwidth signal, drops resolution and probes back up, and every resolution
	// change forces clients to rebuild their decoder.
	// Deliberately NOT RegisterDefaultInterceptors: that includes the TWCC
	// feedback sender, and TWCC feedback drives Ring's send-side bandwidth
	// estimator through a startup probe that changes resolution several times a
	// few seconds into every stream. werift sent plain receiver reports and no
	// TWCC, and Ring holds a steady resolution for it. Mimic that.
	//
	// NACK is on. Loss on this leg is invisible to everything downstream, which
	// only ever sees the stream we forward, so a gap here reaches a decoder as an
	// access unit that looks complete and is not. Ring holds capacity for the
	// retransmissions either way, since the offer advertises nack and registers
	// RTX; not asking simply wasted it.
	//
	// This was previously left off on the grounds that a repaired packet arrives
	// after the ones already forwarded past it and would be dropped again here.
	// That was true only while the publisher discarded out of order packets, on
	// the theory that consumers need strictly consecutive sequence numbers. They
	// do not, and that filter is gone; a jitter buffer is what reorders a late
	// arrival. Worth watching at startup though: Ring used to answer the NACKs
	// for its own opening burst with hundreds of retransmissions, arriving just
	// as a player is bringing its decoder up.
	i := &interceptor.Registry{}
	if err := webrtc.ConfigureRTCPReports(i); err != nil {
		return nil, err
	}
	if err := webrtc.ConfigureNack(m, i); err != nil {
		return nil, err
	}

	api := webrtc.NewAPI(webrtc.WithMediaEngine(m), webrtc.WithInterceptorRegistry(i))

	var servers []webrtc.ICEServer
	for _, u := range ringICEServers {
		servers = append(servers, webrtc.ICEServer{URLs: []string{u}})
	}

	return api.NewPeerConnection(webrtc.Configuration{ICEServers: servers})
}

type incoming struct {
	track *webrtc.TrackRemote
	recv  *webrtc.RTPReceiver
}

// runSession terminates one Ring stream and publishes it, returning when the
// stream ends. It never exits the process: in daemon mode one camera failing
// must not take the others down with it, which is why every failure here is a
// returned error rather than a fatal.
func runSession(cfg sessionConfig, stopReq <-chan struct{}) error {
	if err := cfg.validate(); err != nil {
		return err
	}

	pc, err := newPeerConnection(cfg.videoCodec, cfg.h265Fmtp)
	if err != nil {
		return fmt.Errorf("peer connection: %v", err)
	}
	// Failing after this point used to be free, because the process exited on
	// the spot. A daemon keeps running, so anything already built has to be
	// handed back or every failed start leaks a peer connection, a signaling
	// websocket and its goroutines. All three of these are safe to call twice,
	// so the orderly shutdown below still runs first.
	defer func() { _ = pc.Close() }()

	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionSendrecv}); err != nil {
		return fmt.Errorf("audio transceiver: %v", err)
	}
	if _, err := pc.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo,
		webrtc.RTPTransceiverInit{Direction: webrtc.RTPTransceiverDirectionRecvonly}); err != nil {
		return fmt.Errorf("video transceiver: %v", err)
	}

	tracks := make(chan incoming, 4)
	pc.OnTrack(func(t *webrtc.TrackRemote, r *webrtc.RTPReceiver) {
		cfg.lg.Printf("track: kind=%s codec=%s pt=%d", t.Kind(), t.Codec().MimeType, t.PayloadType())
		tracks <- incoming{track: t, recv: r}
	})

	pc.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		cfg.lg.Printf("peer connection state: %s", s)
	})

	sig, err := newSignaling(cfg.lg, cfg.ticket, cfg.cameraID)
	if err != nil {
		return fmt.Errorf("signaling: %v", err)
	}
	defer sig.shutdown()

	var answerSDP string
	var answerErr error
	var answerOnce sync.Once
	answered := make(chan struct{})

	sig.onAnswer = func(sdp string) {
		answerOnce.Do(func() {
			answerSDP = sdp
			var interesting []string
			for _, l := range strings.Split(sdp, "\n") {
				l = strings.TrimRight(l, "\r")
				low := strings.ToLower(l)
				if strings.HasPrefix(l, "m=video") || strings.HasPrefix(l, "b=") ||
					strings.Contains(low, "profile-level") || strings.Contains(low, "imageattr") ||
					strings.Contains(low, "framerate") {
					interesting = append(interesting, l)
				}
			}
			cfg.lg.Printf("answer video params: %s", strings.Join(interesting, " | "))
			if err := pc.SetRemoteDescription(webrtc.SessionDescription{
				Type: webrtc.SDPTypeAnswer, SDP: sdp,
			}); err != nil {
				answerErr = fmt.Errorf("set remote description: %w", err)
			}
			close(answered)
		})
	}
	sig.onCandidate = func(candidate string, mline uint16) {
		idx := mline
		if err := pc.AddICECandidate(webrtc.ICECandidateInit{
			Candidate: candidate, SDPMLineIndex: &idx,
		}); err != nil {
			cfg.lg.Printf("add ice candidate: %v", err)
		}
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return fmt.Errorf("create offer: %v", err)
	}
	if err := pc.SetLocalDescription(offer); err != nil {
		return fmt.Errorf("set local description: %v", err)
	}

	goSafe(cfg.lg, "signaling read loop", sig.readLoop, sig.shutdown)
	goSafe(cfg.lg, "signaling keepalive", sig.keepalive, sig.shutdown)

	if err := sig.sendOffer(offer.SDP); err != nil {
		return fmt.Errorf("send offer: %v", err)
	}
	cfg.lg.Printf("offer sent for camera %d", cfg.cameraID)
	for _, l := range strings.Split(offer.SDP, "\n") {
		l = strings.TrimRight(l, "\r")
		low := strings.ToLower(l)
		if strings.HasPrefix(l, "m=video") || strings.HasPrefix(l, "b=") ||
			strings.Contains(low, "fmtp") || strings.Contains(low, "rtcp-fb") ||
			strings.Contains(low, "imageattr") {
			cfg.lg.Printf("offer: %s", l)
		}
	}

	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		if err := sig.sendCandidate(c.ToJSON().Candidate, 0); err != nil {
			cfg.lg.Printf("send candidate: %v", err)
		}
	})

	select {
	case <-answered:
		if answerErr != nil {
			return answerErr
		}
	case <-time.After(30 * time.Second):
		return errors.New("timed out waiting for answer from Ring")
	}

	// Start ffmpeg on the answer, before any RTP arrives, so its sockets are
	// bound by the time packets start flowing. Everything the SDP needs comes
	// from the answer, not from the tracks. Waiting for tracks first costs half a
	// second during which the first keyframe is sent to a socket nothing is
	// listening on, leaving the decoder blind until Ring's next one two seconds
	// later. The pipeline this replaced started ffmpeg here too.
	usingOpus := strings.Contains(strings.ToLower(answerSDP), "opus")

	// targetURL is where the RTSP publisher connects: ffmpeg when it is in the
	// path, otherwise the RTSP server itself.
	var (
		relay     *ffmpegRelay
		targetURL string
	)
	switch cfg.transport {
	case "direct":
		// Ring's own RTP reaches the server untouched, with its packetization
		// intact. Nothing transcodes, so only the native Opus track exists.
		targetURL = cfg.publishURL
		cfg.lg.Printf("publishing Ring's packets directly, ffmpeg is not in the path")
	case "rtsp":
		relay, targetURL, err = startFfmpegListen(cfg.lg, cfg.ffmpegPath, cfg.publishURL, usingOpus, cfg.ffmpegStats)
	case "udp":
		relay, err = startFfmpegRelay(cfg.lg, cfg.ffmpegPath, cfg.publishURL, answerSDP, usingOpus, cfg.ffmpegStats)
	}
	if err != nil {
		return fmt.Errorf("ffmpeg relay: %v", err)
	}
	defer relay.stop()

	// Collect tracks, then publish once we have them (or the wait expires).
	var video, audio *webrtc.TrackRemote
	var videoRecv, audioRecv *webrtc.RTPReceiver
	deadline := time.After(cfg.trackWait)
collect:
	for {
		select {
		case in := <-tracks:
			if in.track.Kind() == webrtc.RTPCodecTypeVideo {
				video, videoRecv = in.track, in.recv
			} else {
				audio, audioRecv = in.track, in.recv
			}
			if video != nil && audio != nil {
				break collect
			}
		case <-deadline:
			break collect
		}
	}

	if video == nil {
		return errors.New("no video track received")
	}

	h265 := cfg.videoCodec == "h265"
	var haveKeyframe atomic.Bool
	videoStats := &trackStats{lg: cfg.lg, name: "video", video: true, clockRate: 90000, h264: !h265}
	audioStats := &trackStats{lg: cfg.lg, name: "audio", clockRate: 48000}

	// Ring's sender reports are the only thing that ties the two tracks to a
	// common clock, so start reading them before any packet is forwarded.
	videoClock := &ntpClock{clockRate: 90000}
	audioClock := &ntpClock{clockRate: 48000}
	if audio != nil {
		if rate := audio.Codec().ClockRate; rate != 0 {
			audioClock.clockRate = rate
		}
	}
	goSafe(cfg.lg, "video sender reports", func() {
		readSenderReports(cfg.lg, "video", videoRecv, videoClock)
	}, nil)
	if audio != nil {
		goSafe(cfg.lg, "audio sender reports", func() {
			readSenderReports(cfg.lg, "audio", audioRecv, audioClock)
		}, nil)
	}

	var (
		pub                    sink
		writeVideo, writeAudio func(*rtp.Packet, time.Time) error
	)

	if cfg.newSink != nil || targetURL != "" {
		// The RTSP description has to carry the parameter sets up front, so read
		// forward until they are all seen. Everything read here is held and
		// replayed, so the keyframe they belong to is not lost.
		vSpec := &videoSpec{payloadType: uint8(video.PayloadType()), h265: h265}
		collector := &paramCollector{h265: h265, spec: vSpec}

		// Ask for a keyframe: Ring sends parameter sets only alongside one, and
		// its GOP is two seconds, so waiting for the next costs that long.
		if err := pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{
			MediaSSRC: uint32(video.SSRC()),
		}}); err != nil {
			cfg.lg.Printf("keyframe request: %v", err)
		}

		// Ring hands over a pre-roll backlog when a session opens, several seconds
		// of it on a doorbell. Anchoring on the first parameter set run in that
		// backlog starts the stream that far in the past and then forwards the
		// whole thing at line rate, which is a burst well beyond what a consumer
		// bringing up a decoder can absorb. Drain what is already buffered and let
		// the collector keep re-anchoring, so publishing begins at the newest
		// keyframe rather than the oldest.
		//
		// A read that times out is how the end of the backlog is recognised: while
		// draining, packets arrive back to back, whereas at the live edge there is
		// an inter frame gap well beyond this deadline.
		overall := time.Now().Add(10 * time.Second)
		complete, drained := false, 0
		for len(collector.held) < 20000 {
			wait := 20 * time.Millisecond
			if !complete {
				// Nothing publishable yet, so wait properly for a keyframe.
				if wait = time.Until(overall); wait <= 0 {
					break
				}
			}
			_ = video.SetReadDeadline(time.Now().Add(wait))
			pkt, _, err := video.ReadRTP()
			if err != nil {
				if complete && isReadTimeout(err) {
					break // caught up with live, holding a whole run
				}
				break
			}
			drained++
			complete = collector.offer(pkt)
		}
		_ = video.SetReadDeadline(time.Time{})
		held := collector.held

		if !collector.complete() {
			return errors.New("no parameter sets found in the stream")
		}
		cfg.lg.Printf("parameter sets for RTSP description: vps=%d sps=%d pps=%d (held %d of %d packets, dropped %d of pre-roll)",
			len(vSpec.vps), len(vSpec.sps), len(vSpec.pps), len(held), drained, drained-len(held))

		var aSpec *audioSpec
		if audio != nil {
			ch := int(audio.Codec().Channels)
			if ch == 0 {
				ch = 2
			}
			aSpec = &audioSpec{
				payloadType: uint8(audio.PayloadType()),
				channels:    ch,
				isOpus:      strings.EqualFold(audio.Codec().MimeType, webrtc.MimeTypeOpus),
			}
		}

		if cfg.newSink != nil {
			pub, err = cfg.newSink(vSpec, aSpec)
		} else {
			pub, err = newPublisherWithRetry(cfg.lg, targetURL, vSpec, aSpec, 10*time.Second)
		}
		if err != nil {
			relay.stop()
			return fmt.Errorf("rtsp publisher: %v", err)
		}
		// Nothing may be written before a reader is attached: the RTSP server
		// delivers to whoever is listening at the time and keeps no history, so
		// the keyframe below would otherwise be published to nobody and the
		// reader would open mid GOP on frames it cannot decode. Ring keeps
		// sending meanwhile and pion buffers it, so the wait costs nothing.
		pub.waitReady(5 * time.Second)

		writeVideo, writeAudio = pub.writeVideo, pub.writeAudio

		// held begins at a parameter set run and carries the keyframe that follows
		// it, so the consumer already has a complete starting point and the pump
		// must continue straight on from there. Leaving the gate shut here made it
		// discard the rest of the GOP waiting for the next keyframe, which threw
		// away two seconds of video and handed the consumer a manufactured gap of
		// several hundred packets at every session start.
		haveKeyframe.Store(true)
		for _, pkt := range held {
			videoStats.observe(pkt)
			if err := writeVideo(pkt, videoClock.at(pkt.Timestamp)); err != nil {
				break
			}
		}
	} else {
		writeVideo, writeAudio = relay.writeVideo, relay.writeAudio
	}

	if writeVideo == nil {
		return errors.New("no destination for the stream was built")
	}

	if cfg.publishURL != "" {
		cfg.lg.Printf("publishing to %s", cfg.publishURL)
	} else {
		cfg.lg.Printf("serving readers directly, nothing is published upstream")
	}
	// stdout carries machine-readable status for the supervising worker
	cfg.state("active")

	stop := make(chan struct{})
	var (
		stopMu  sync.Mutex
		stopped bool
	)
	// Guarded by a flag rather than sync.Once: the signaling shutdown calls
	// onClose, which is this function, which shuts the signaling down again.
	// sync.Once.Do deadlocks when re-entered, which left the process alive until
	// the supervisor gave up waiting and sent SIGKILL.
	shutdown := func() {
		stopMu.Lock()
		if stopped {
			stopMu.Unlock()
			return
		}
		stopped = true
		stopMu.Unlock()

		close(stop)
		if pub != nil {
			pub.close()
		}
		relay.stop()
		sig.shutdown()
		_ = pc.Close()
		cfg.state("inactive")
	}
	sig.onClose = shutdown

	goSafe(cfg.lg, "stats reporting", func() {
		reportEvery(5*time.Second, stop, videoStats, audioStats)
	}, nil)

	// Nothing before the first keyframe can be decoded. H.264 mostly conceals
	// the damage, HEVC renders it as green blocks, so hold video back until a
	// random access point arrives rather than forwarding garbage.

	var discardedBeforeKeyframe int
	pump := func(t *webrtc.TrackRemote, write func(*rtp.Packet, time.Time) error, st *trackStats, clk *ntpClock, jb *reorderBuffer, gate bool) {
		emit := func(pkt *rtp.Packet) bool {
			if gate && !haveKeyframe.Load() {
				if !isRandomAccessPoint(pkt.Payload, h265) {
					discardedBeforeKeyframe++
					return true
				}
				haveKeyframe.Store(true)
				cfg.lg.Printf("first keyframe received after discarding %d packets, forwarding video",
					discardedBeforeKeyframe)
			}
			st.observe(pkt)
			if err := write(pkt, clk.at(pkt.Timestamp)); err != nil {
				cfg.lg.Printf("%s publish error: %v", st.name, err)
				shutdown()
				return false
			}
			return true
		}

		for {
			// A deadline only exists while a hole is being held open, so an
			// undisturbed stream blocks in ReadRTP exactly as it did before.
			if jb != nil {
				if due, ok := jb.deadline(); ok {
					_ = t.SetReadDeadline(due)
				} else {
					_ = t.SetReadDeadline(time.Time{})
				}
			}

			pkt, _, err := t.ReadRTP()
			if err != nil {
				if jb != nil && isReadTimeout(err) {
					for _, p := range jb.expire(time.Now()) {
						if !emit(p) {
							return
						}
					}
					continue
				}
				cfg.lg.Printf("%s track ended: %v", st.name, err)
				shutdown()
				return
			}

			if jb == nil {
				if !emit(pkt) {
					return
				}
				continue
			}
			for _, p := range jb.push(pkt, time.Now()) {
				if !emit(p) {
					return
				}
			}
		}
	}

	// Ring sends parameter sets only with a keyframe and its GOP is two seconds,
	// while the consumer needs a moment to bind its sockets, so the keyframe that
	// happens to be in flight at startup is usually lost. Ask for fresh ones,
	// which is what ring-mqtt did with "request a key frame now that ffmpeg is
	// ready to receive". Without this the decoder is blind until the next IDR.
	requestKeyFrame := func() bool {
		if err := pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{
			MediaSSRC: uint32(video.SSRC()),
		}}); err != nil {
			cfg.lg.Printf("keyframe request: %v", err)
			return false
		}
		return true
	}

	var videoReorder *reorderBuffer
	if cfg.reorderWait > 0 {
		videoReorder = newReorderBuffer(cfg.lg, "video", cfg.reorderWait, cfg.reorderMax, cfg.reorderDepth)
		cfg.lg.Printf("holding video gaps open for %s to %s, adapting to how long repairs take",
			cfg.reorderWait, cfg.reorderMax)
	}
	goSafe(cfg.lg, "video pump", func() { pump(video, writeVideo, videoStats, videoClock, videoReorder, true) }, shutdown)
	if audio != nil {
		goSafe(cfg.lg, "audio pump", func() { pump(audio, writeAudio, audioStats, audioClock, nil, false) }, shutdown)
	}

	// Only ask when one has not already turned up. pion usually has a keyframe
	// buffered by the time the pump starts, and asking anyway makes Ring send a
	// second large IDR straight after the first, doubling the burst into
	// ffmpeg's receive buffer and costing packets out of the middle of it.
	goSafe(cfg.lg, "keyframe requests", func() {
		t := time.NewTicker(200 * time.Millisecond)
		defer t.Stop()
		for tries := 0; tries < 20; tries++ {
			select {
			case <-stop:
				return
			case <-t.C:
			}
			if haveKeyframe.Load() {
				return
			}
			if !requestKeyFrame() {
				return
			}
		}
		cfg.lg.Printf("WARNING: no keyframe after repeated requests")
	}, nil)

	select {
	case <-stopReq:
		cfg.lg.Printf("stop requested")
	case <-stop:
	}
	shutdown()
	time.Sleep(200 * time.Millisecond)
	return nil
}
