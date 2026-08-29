package main

import (
	"bytes"
	"log"
	"testing"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
)

func testMedias() []*description.Media {
	return []*description.Media{{
		Type: description.MediaTypeVideo,
		Formats: []format.Format{&format.H264{
			PayloadTyp:        96,
			SPS:               []byte{0x67, 0x42, 0x00, 0x1f},
			PPS:               []byte{0x68, 0xce, 0x38, 0x80},
			PacketizationMode: 1,
		}},
	}}
}

// SETUP arrives from publishers as well as readers, and gortsplib panics inside
// its own session goroutine if a publisher's SETUP is answered with a stream.
// That panic happens in library-owned goroutines, so nothing in this codebase
// can recover it: it takes the whole daemon down. This exercises the publish
// path that event playback depends on.
func TestEventPublisherCanAnnounceAndRecord(t *testing.T) {
	addr := "127.0.0.1:18995"
	s := newStreamServer(log.New(&bytes.Buffer{}, "", 0), addr, "", "", nil)
	if err := s.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.close()

	// Playback is already under way as far as the server is concerned; ffmpeg
	// is what connects to publish into it.
	ss := s.addForTest("cam_event")

	pub := &gortsplib.Client{}
	if err := pub.StartRecording("rtsp://"+addr+"/cam_event", &description.Session{Medias: testMedias()}); err != nil {
		t.Fatalf("publisher could not announce and record: %v", err)
	}
	defer pub.Close()

	// finish is what releases a DESCRIBE waiting on the playback.
	select {
	case <-ss.done:
		if ss.err != nil {
			t.Fatalf("stream reported an error: %v", ss.err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("announce never released the waiting describe")
	}

	if ss.serverStream() == nil {
		t.Fatal("no server stream was created for readers")
	}
}

// Only a playback the server started may be published to. Without this, opening
// the publisher side lets anything that can reach the port inject a stream into
// a camera's path.
func TestServerRefusesUnexpectedPublisher(t *testing.T) {
	addr := "127.0.0.1:18994"
	s := newStreamServer(log.New(&bytes.Buffer{}, "", 0), addr, "", "", nil)
	if err := s.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.close()

	pub := &gortsplib.Client{}
	err := pub.StartRecording("rtsp://"+addr+"/cam_event", &description.Session{Medias: testMedias()})
	if err == nil {
		pub.Close()
		t.Fatal("server accepted a publisher for a playback it never started")
	}
}

// A live path must never accept a publisher: those are served from a Ring
// session, not from anything dialling in.
func TestServerRefusesPublisherOnLivePath(t *testing.T) {
	addr := "127.0.0.1:18993"
	s := newStreamServer(log.New(&bytes.Buffer{}, "", 0), addr, "", "", nil)
	if err := s.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer s.close()

	s.addForTest("cam_live")

	pub := &gortsplib.Client{}
	err := pub.StartRecording("rtsp://"+addr+"/cam_live", &description.Session{Medias: testMedias()})
	if err == nil {
		pub.Close()
		t.Fatal("server accepted a publisher on a live camera path")
	}
}
