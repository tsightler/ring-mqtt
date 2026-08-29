package main

import (
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/base"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/liberrors"
	"github.com/pion/rtp"
)

// activateFunc is asked to describe a stream that nobody is serving yet. It
// returns the configuration for a Ring session, which means fetching a
// signaling ticket, so it can be slow and can fail.
type activateFunc func(path string) (sessionConfig, error)

// streamServer serves Ring cameras over RTSP and starts them on demand.
//
// The chain this replaces synthesised on-demand activation out of a go2rtc
// exec source, two shell scripts, the mosquitto CLI and an MQTT round trip,
// purely to answer "has someone asked to watch?". RTSP answers that natively: a
// DESCRIBE for a path that is not yet running is the request, and the last
// reader leaving is the release.
type streamServer struct {
	lg            *log.Logger
	activate      activateFunc
	activateEvent activateEventFunc

	// Credentials for readers. This server is what camera.js advertises to
	// Home Assistant and to any RTSP client on the network, so when they are
	// configured they gate every request.
	user string
	pass string

	// describeWait bounds how long a DESCRIBE blocks while Ring is contacted
	// and the first keyframe is parsed. Ring's GOP is two seconds and a ticket
	// request is a round trip to the internet, so this is generous.
	describeWait time.Duration

	srv *gortsplib.Server

	mu      sync.Mutex
	streams map[string]*servedStream
	// readers maps each RTSP session to the camera it is watching. Without it
	// there is no way to tell which camera a closing session was reading, and
	// releasing the wrong one stops a camera somebody else is still watching.
	readers map[*gortsplib.ServerSession]*servedStream
	// publishers maps an ffmpeg session to the event it is playing back, so its
	// disconnect ends that playback and not some other stream.
	publishers map[*gortsplib.ServerSession]*servedStream
}

// servedStream is one camera's live session and the readers attached to it.
type servedStream struct {
	path string

	// ready closes once the session has parsed its parameter sets and the
	// stream can be described. err is only meaningful after it closes.
	ready sync.Once
	done  chan struct{}
	err   error

	stream *gortsplib.ServerStream
	video  *description.Media
	audio  *description.Media

	// playing closes when the first reader is playing, so a session does not
	// publish its opening keyframe into a stream nobody is attached to yet.
	playing     chan struct{}
	playingOnce sync.Once

	stop      chan struct{}
	stopOnce  sync.Once
	publisher *gortsplib.ServerSession

	mu      sync.Mutex
	readers int
	// pinned keeps a camera running with nothing watching it, which is what the
	// MQTT stream switch asks for when it is turned on directly.
	pinned bool
	rs     videoResync
	lg     *log.Logger
}

func newStreamServer(lg *log.Logger, addr, user, pass string, activate activateFunc) *streamServer {
	s := &streamServer{
		lg:           orDefault(lg),
		activate:     activate,
		user:         user,
		pass:         pass,
		describeWait: 15 * time.Second,
		streams:      map[string]*servedStream{},
		readers:      map[*gortsplib.ServerSession]*servedStream{},
		publishers:   map[*gortsplib.ServerSession]*servedStream{},
	}
	s.srv = &gortsplib.Server{
		Handler:     s,
		RTSPAddress: addr,
		// gortsplib defaults to 256 packets per reader, which at these
		// resolutions is a fraction of a second: any hesitation from the reader
		// overflows it, packets are dropped, and it complains through the
		// standard logger on every one. Ring's own bursts and an ultrafast
		// x264 transcode both arrive faster than realtime, so give it room.
		// Must be a power of two.
		WriteQueueSize: 4096,
	}
	return s
}

func (s *streamServer) start() error {
	if err := s.srv.Start(); err != nil {
		return fmt.Errorf("rtsp server on %s: %w", s.srv.RTSPAddress, err)
	}
	s.lg.Printf("rtsp server listening on %s", s.srv.RTSPAddress)
	return nil
}

func (s *streamServer) close() {
	s.mu.Lock()
	for _, ss := range s.streams {
		ss.shutdown()
	}
	s.streams = map[string]*servedStream{}
	s.mu.Unlock()
	s.srv.Close()
}

// authorized reports whether a request may proceed. It is deliberately checked
// before the camera is started: activating first would let an unauthenticated
// DESCRIBE open a Ring session and burn battery and bandwidth on a caller that
// is about to be refused.
func (s *streamServer) authorized(conn *gortsplib.ServerConn, req *base.Request) bool {
	if s.user == "" && s.pass == "" {
		return true
	}
	return conn.VerifyCredentials(req, s.user, s.pass)
}

// streamPath normalises what RTSP gives us. gortsplib reports the path with a
// leading slash, while ring-mqtt registers cameras under a bare name, and a
// mismatch here fails as "no camera registered" rather than as anything that
// points at the cause.
func streamPath(p string) string {
	return strings.TrimPrefix(p, "/")
}

// obtain returns the stream for a path, starting the camera if it is idle.
func (s *streamServer) obtain(path string) (*servedStream, error) {
	s.mu.Lock()
	ss, running := s.streams[path]
	if !running {
		ss = &servedStream{
			path:    path,
			done:    make(chan struct{}),
			playing: make(chan struct{}),
			stop:    make(chan struct{}),
			lg:      s.lg,
		}
		s.streams[path] = ss
		go s.run(ss)
	}
	s.mu.Unlock()

	select {
	case <-ss.done:
		return ss, ss.err
	case <-time.After(s.describeWait):
		return nil, fmt.Errorf("timed out waiting for %s to start", path)
	}
}

// run drives one camera's session for as long as anyone is watching.
func (s *streamServer) run(ss *servedStream) {
	// A daemon serves every camera from one process, so a panic in any of them
	// would take the rest down with it. Contain it here.
	defer func() {
		if r := recover(); r != nil {
			s.lg.Printf("panic serving %s: %v", ss.path, r)
			ss.finish(fmt.Errorf("panic serving %s: %v", ss.path, r))
		}
		ss.shutdown()
		s.mu.Lock()
		if s.streams[ss.path] == ss {
			delete(s.streams, ss.path)
		}
		s.mu.Unlock()
	}()

	if isEventPath(ss.path) {
		if s.activateEvent == nil {
			ss.finish(fmt.Errorf("event playback is not configured"))
			return
		}
		s.runEvent(ss)
		return
	}

	cfg, err := s.activate(ss.path)
	if err != nil {
		ss.finish(err)
		return
	}
	// The session names its own logger, but not until runSession normalises the
	// config, and the sink logs from here long before that. Name it now so every
	// line a served stream produces carries its camera, which is the only thing
	// that makes a daemon log with several cameras in it readable.
	if cfg.lg == nil {
		cfg.lg = newSessionLogger(cfg.name)
	}
	ss.mu.Lock()
	ss.lg = cfg.lg
	ss.mu.Unlock()

	// The session builds its description from the stream, so the ServerStream
	// cannot exist until the parameter sets have been parsed.
	cfg.newSink = func(v *videoSpec, a *audioSpec) (sink, error) {
		video, audio, err := buildMedias(v, a)
		if err != nil {
			return nil, err
		}
		stream := &gortsplib.ServerStream{
			Server: s.srv,
			Desc:   &description.Session{Medias: mediaList(video, audio)},
		}
		if err := stream.Initialize(); err != nil {
			return nil, fmt.Errorf("server stream: %w", err)
		}
		ss.mu.Lock()
		ss.stream, ss.video, ss.audio = stream, video, audio
		ss.rs.lg = ss.lg
		if v != nil {
			ss.rs.h265 = v.h265
		}
		ss.mu.Unlock()

		ss.finish(nil)
		return ss, nil
	}

	if err := runSession(cfg, ss.stop); err != nil {
		ss.lg.Printf("session ended: %v", err)
		// If it failed before the sink was built, anyone waiting on DESCRIBE is
		// still blocked and has to be released.
		ss.finish(err)
	}
}

func (ss *servedStream) finish(err error) {
	ss.ready.Do(func() {
		ss.err = err
		close(ss.done)
	})
}

func (ss *servedStream) shutdown() {
	ss.stopOnce.Do(func() {
		close(ss.stop)
		ss.mu.Lock()
		stream := ss.stream
		ss.mu.Unlock()
		if stream != nil {
			stream.Close()
		}
	})
}

// --- sink, serving readers rather than publishing to someone else -----------

func (ss *servedStream) writeVideo(pkt *rtp.Packet, ntp time.Time) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.stream == nil || ss.video == nil {
		return nil
	}
	if pkt = ss.rs.filter(pkt); pkt == nil {
		return nil
	}
	return ss.stream.WritePacketRTPWithNTP(ss.video, sanitize(pkt), ntp)
}

func (ss *servedStream) writeAudio(pkt *rtp.Packet, ntp time.Time) error {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.stream == nil || ss.audio == nil {
		return nil
	}
	return ss.stream.WritePacketRTPWithNTP(ss.audio, sanitize(pkt), ntp)
}

// waitReady blocks until a reader is playing, so the opening keyframe is
// published to someone rather than into an empty stream. A stream held open
// with nothing watching it simply waits out the timeout.
func (ss *servedStream) waitReady(timeout time.Duration) {
	started := time.Now()
	select {
	case <-ss.playing:
		ss.logger().Printf("first reader attached after %s, publishing from the keyframe",
			time.Since(started).Round(time.Millisecond))
	case <-ss.stop:
	case <-time.After(timeout):
		ss.logger().Printf("no reader attached within %s, publishing anyway", timeout)
	}
}

func (ss *servedStream) close() { ss.shutdown() }

// logger returns the stream's own logger, which carries the camera name once
// activation has supplied one, falling back to the server's until then.
func (ss *servedStream) logger() *log.Logger {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	return orDefault(ss.lg)
}

func (ss *servedStream) serverStream() *gortsplib.ServerStream {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	return ss.stream
}

// --- RTSP handlers ----------------------------------------------------------

func (s *streamServer) OnDescribe(ctx *gortsplib.ServerHandlerOnDescribeCtx) (*base.Response, *gortsplib.ServerStream, error) {
	if !s.authorized(ctx.Conn, ctx.Request) {
		return &base.Response{StatusCode: base.StatusUnauthorized}, nil, liberrors.ErrServerAuth{}
	}
	ss, err := s.obtain(streamPath(ctx.Path))
	if err != nil {
		s.lg.Printf("describe %s: %v", streamPath(ctx.Path), err)
		return &base.Response{StatusCode: base.StatusNotFound}, nil, nil
	}
	return &base.Response{StatusCode: base.StatusOK}, ss.serverStream(), nil
}

func (s *streamServer) OnSetup(ctx *gortsplib.ServerHandlerOnSetupCtx) (*base.Response, *gortsplib.ServerStream, error) {
	if !s.authorized(ctx.Conn, ctx.Request) {
		return &base.Response{StatusCode: base.StatusUnauthorized}, nil, liberrors.ErrServerAuth{}
	}

	// SETUP arrives from publishers as well as readers. gortsplib requires a nil
	// stream for a publisher and panics inside its own session goroutine if it
	// gets one, which no recover of ours can catch. It also must not go through
	// obtain: the publisher is ffmpeg feeding a playback that is already
	// running, not somebody asking for one to start.
	if ctx.Session.State() == gortsplib.ServerSessionStatePreRecord {
		return &base.Response{StatusCode: base.StatusOK}, nil, nil
	}

	ss, err := s.obtain(streamPath(ctx.Path))
	if err != nil {
		return &base.Response{StatusCode: base.StatusNotFound}, nil, nil
	}
	return &base.Response{StatusCode: base.StatusOK}, ss.serverStream(), nil
}

func (s *streamServer) OnPlay(ctx *gortsplib.ServerHandlerOnPlayCtx) (*base.Response, error) {
	path := streamPath(ctx.Path)
	s.mu.Lock()
	ss := s.streams[path]
	if ss != nil {
		s.readers[ctx.Session] = ss
	}
	s.mu.Unlock()

	if ss != nil {
		ss.mu.Lock()
		ss.readers++
		n := ss.readers
		ss.mu.Unlock()
		ss.logger().Printf("reader started (%d watching)", n)
		// Nil when a servedStream is built directly, as tests do; a session built
		// by the server always has it.
		ss.playingOnce.Do(func() {
			if ss.playing != nil {
				close(ss.playing)
			}
		})
	}
	return &base.Response{StatusCode: base.StatusOK}, nil
}

// OnSessionClose releases the camera once the last reader has gone, which is
// what the stop half of the old exec script existed to do.
func (s *streamServer) OnSessionClose(ctx *gortsplib.ServerHandlerOnSessionCloseCtx) {
	s.mu.Lock()
	publishing := s.publishers[ctx.Session]
	delete(s.publishers, ctx.Session)
	ss := s.readers[ctx.Session]
	delete(s.readers, ctx.Session)
	s.mu.Unlock()

	if publishing != nil {
		publishing.logger().Printf("playback publisher disconnected, ending the stream")
		publishing.shutdown()
		return
	}

	if ss == nil {
		// A session that never reached PLAY, so it was never counted.
		return
	}

	ss.mu.Lock()
	if ss.readers > 0 {
		ss.readers--
	}
	remaining := ss.readers
	ss.mu.Unlock()

	if remaining > 0 {
		ss.logger().Printf("reader left (%d still watching)", remaining)
		return
	}
	ss.mu.Lock()
	pinned := ss.pinned
	ss.mu.Unlock()
	if pinned {
		ss.logger().Printf("last reader left, holding it open on request")
		return
	}
	ss.logger().Printf("last reader left, stopping the camera")
	ss.shutdown()
}

// pin starts a camera and holds it open regardless of whether anyone is
// watching over RTSP.
func (s *streamServer) pin(path string) {
	go func() {
		ss, err := s.obtain(path)
		if err != nil {
			s.lg.Printf("could not start %s on request: %v", path, err)
			return
		}
		ss.mu.Lock()
		ss.pinned = true
		ss.mu.Unlock()
		s.lg.Printf("holding %s open on request", path)
	}()
}

// unpin releases a held camera, stopping it if nothing else is watching.
func (s *streamServer) unpin(path string) {
	s.mu.Lock()
	ss := s.streams[path]
	s.mu.Unlock()
	if ss == nil {
		return
	}

	ss.mu.Lock()
	ss.pinned = false
	idle := ss.readers == 0
	ss.mu.Unlock()

	if idle {
		s.lg.Printf("released %s with nothing watching, stopping the camera", path)
		ss.shutdown()
	}
}
