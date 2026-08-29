package main

import (
	"bytes"
	"log"
	"testing"
	"time"

	"github.com/bluenviron/gortsplib/v5"
)

func testServer(t *testing.T) *streamServer {
	t.Helper()
	s := newStreamServer(log.New(&bytes.Buffer{}, "", 0), "127.0.0.1:0", "", "", nil)
	return s
}

// register a stream as if it were already running, without contacting Ring.
func (s *streamServer) addForTest(path string) *servedStream {
	ss := &servedStream{
		path: path,
		done: make(chan struct{}),
		stop: make(chan struct{}),
		lg:   s.lg,
	}
	s.streams[path] = ss
	// A stream registered this way stands in for one already running, so
	// anything waiting on it is released immediately.
	ss.finish(nil)
	return ss
}

func stopped(ss *servedStream) bool {
	select {
	case <-ss.stop:
		return true
	default:
		return false
	}
}

func TestServerReleasesCameraOnlyAfterLastReader(t *testing.T) {
	s := testServer(t)
	ss := s.addForTest("cam_live")

	a, b := &gortsplib.ServerSession{}, &gortsplib.ServerSession{}
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: a, Path: "cam_live"})
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: b, Path: "cam_live"})

	s.OnSessionClose(&gortsplib.ServerHandlerOnSessionCloseCtx{Session: a})
	if stopped(ss) {
		t.Fatal("camera stopped while a reader was still watching")
	}

	s.OnSessionClose(&gortsplib.ServerHandlerOnSessionCloseCtx{Session: b})
	if !stopped(ss) {
		t.Fatal("camera not released after the last reader left")
	}
}

// Closing a session must release the camera it was actually reading. Scanning
// for any stream with readers stops whichever one happens to be found first,
// which can be a camera somebody else is still watching.
func TestServerReleasesTheCorrectCamera(t *testing.T) {
	s := testServer(t)
	front := s.addForTest("front_live")
	back := s.addForTest("back_live")

	fs, bs := &gortsplib.ServerSession{}, &gortsplib.ServerSession{}
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: fs, Path: "front_live"})
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: bs, Path: "back_live"})

	s.OnSessionClose(&gortsplib.ServerHandlerOnSessionCloseCtx{Session: fs})

	if !stopped(front) {
		t.Fatal("front camera was not released by its own reader leaving")
	}
	if stopped(back) {
		t.Fatal("back camera was stopped by an unrelated session closing")
	}
}

// A session that never reached PLAY was never counted, so closing it must not
// decrement anything.
func TestServerIgnoresSessionsThatNeverPlayed(t *testing.T) {
	s := testServer(t)
	ss := s.addForTest("cam_live")

	playing := &gortsplib.ServerSession{}
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: playing, Path: "cam_live"})

	s.OnSessionClose(&gortsplib.ServerHandlerOnSessionCloseCtx{Session: &gortsplib.ServerSession{}})
	if stopped(ss) {
		t.Fatal("a session that never played released the camera")
	}
}

func waitForPinned(t *testing.T, ss *servedStream) {
	t.Helper()
	for i := 0; i < 200; i++ {
		ss.mu.Lock()
		pinned := ss.pinned
		ss.mu.Unlock()
		if pinned {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("stream was never pinned")
}

// Turning the MQTT stream switch on holds a camera open with nothing watching
// it over RTSP. This is what replaced the keepalive ffmpeg process that used to
// connect to our own RTSP URL to impersonate a reader.
func TestPinnedCameraSurvivesTheLastReaderLeaving(t *testing.T) {
	s := testServer(t)
	ss := s.addForTest("cam_live")

	s.pin("cam_live")
	waitForPinned(t, ss)

	watcher := &gortsplib.ServerSession{}
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: watcher, Path: "cam_live"})
	s.OnSessionClose(&gortsplib.ServerHandlerOnSessionCloseCtx{Session: watcher})

	if stopped(ss) {
		t.Fatal("a pinned camera was stopped when its last reader left")
	}
}

// Turning the switch off releases it, and with nothing watching that stops the
// camera rather than leaving a Ring session running forever.
func TestUnpinStopsACameraNobodyIsWatching(t *testing.T) {
	s := testServer(t)
	ss := s.addForTest("cam_live")

	s.pin("cam_live")
	waitForPinned(t, ss)

	s.unpin("cam_live")
	if !stopped(ss) {
		t.Fatal("unpinning left the camera running with nobody watching")
	}
}

// Releasing the switch must not cut off someone who is still watching.
func TestUnpinKeepsACameraWithReaders(t *testing.T) {
	s := testServer(t)
	ss := s.addForTest("cam_live")

	s.pin("cam_live")
	waitForPinned(t, ss)

	watcher := &gortsplib.ServerSession{}
	s.OnPlay(&gortsplib.ServerHandlerOnPlayCtx{Session: watcher, Path: "cam_live"})

	s.unpin("cam_live")
	if stopped(ss) {
		t.Fatal("unpinning stopped a camera someone was still watching")
	}

	// ...and once that reader goes, it is no longer held open.
	s.OnSessionClose(&gortsplib.ServerHandlerOnSessionCloseCtx{Session: watcher})
	if !stopped(ss) {
		t.Fatal("camera was not stopped after unpin and the last reader leaving")
	}
}

// A session must not publish its opening keyframe before a reader is attached:
// the RTSP server delivers to whoever is listening at the time and keeps no
// history, so anything written earlier is lost and the reader opens mid GOP.
func TestWaitReadyBlocksUntilAReaderIsPlaying(t *testing.T) {
	ss := &servedStream{
		playing: make(chan struct{}),
		stop:    make(chan struct{}),
		lg:      log.New(&bytes.Buffer{}, "", 0),
	}

	done := make(chan struct{})
	go func() {
		ss.waitReady(2 * time.Second)
		close(done)
	}()

	select {
	case <-done:
		t.Fatal("returned before any reader attached")
	case <-time.After(30 * time.Millisecond):
	}

	ss.playingOnce.Do(func() { close(ss.playing) })

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("did not return once a reader was playing")
	}
}

// A stream held open with nothing watching must not block a session forever.
func TestWaitReadyGivesUpAfterTheTimeout(t *testing.T) {
	ss := &servedStream{
		playing: make(chan struct{}),
		stop:    make(chan struct{}),
		lg:      log.New(&bytes.Buffer{}, "", 0),
	}
	started := time.Now()
	ss.waitReady(50 * time.Millisecond)
	if d := time.Since(started); d < 40*time.Millisecond || d > time.Second {
		t.Fatalf("waited %v, want roughly the 50ms timeout", d)
	}
}

// Shutting a session down must release the wait rather than hold it open.
func TestWaitReadyReturnsOnShutdown(t *testing.T) {
	ss := &servedStream{
		playing: make(chan struct{}),
		stop:    make(chan struct{}),
		lg:      log.New(&bytes.Buffer{}, "", 0),
	}
	done := make(chan struct{})
	go func() { ss.waitReady(10 * time.Second); close(done) }()
	close(ss.stop)
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("still waiting after the session stopped")
	}
}
