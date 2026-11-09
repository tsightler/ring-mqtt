package main

import (
	"bytes"
	"log"
	"testing"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
	"github.com/pion/rtp"
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

// When ffmpeg copies an HEVC MP4 to RTSP with global headers, VPS/SPS/PPS live
// in the SDP description rather than in-band. eventVideoNormalizer must inject
// them once before the first slice of a multi-slice keyframe and split any
// RFC 7798 Type 48 aggregation packets into individual single-NAL packets.
func TestEventVideoNormalizerInjectsParameterSetsAndSplitsAP(t *testing.T) {
	vps := []byte{h265VPS << 1, 1, 0xAA}
	sps := []byte{h265SPS << 1, 1, 0xBB}
	pps := []byte{h265PPS << 1, 1, 0xCC}

	norm := newEventVideoNormalizer(&format.H265{
		PayloadTyp: 96,
		VPS:        vps,
		SPS:        sps,
		PPS:        pps,
	})

	// 2-slice IDR keyframe without in-band parameter sets:
	s1 := &rtp.Packet{
		Header:  rtp.Header{SequenceNumber: 10, Timestamp: 3000, Marker: false},
		Payload: []byte{nalI << 1, 1, 0x80},
	}
	s2 := &rtp.Packet{
		Header:  rtp.Header{SequenceNumber: 11, Timestamp: 3000, Marker: true},
		Payload: []byte{nalI << 1, 1, 0x20},
	}

	out1 := norm.push(s1)
	if len(out1) != 4 {
		t.Fatalf("got %d packets for first keyframe slice, want 4 (VPS, SPS, PPS, IDR1)", len(out1))
	}
	out2 := norm.push(s2)
	if len(out2) != 1 || !out2[0].Marker {
		t.Fatalf("got %d packets for second keyframe slice (marker=%v), want 1 marked packet", len(out2), out2[0].Marker)
	}

	// Sequence numbers must be strictly consecutive across injected packets.
	all := append(out1, out2...)
	for i, p := range all {
		wantSeq := uint16(10 + i)
		if p.SequenceNumber != wantSeq {
			t.Fatalf("pkt[%d] seq=%d, want %d", i, p.SequenceNumber, wantSeq)
		}
	}

	// Type 48 Aggregation Packet carrying two NAL units must be split into two
	// single-NAL RTP packets.
	ap := []byte{
		h265AP << 1, 1,
		0, 3, h265PrefixSEI << 1, 1, 0x11,
		0, 3, nalP << 1, 1, 0x80,
	}
	outAP := norm.push(&rtp.Packet{
		Header:  rtp.Header{SequenceNumber: 12, Timestamp: 6000, Marker: true},
		Payload: ap,
	})
	if len(outAP) != 2 {
		t.Fatalf("got %d packets from AP, want 2", len(outAP))
	}
	if outAP[0].Marker || !outAP[1].Marker {
		t.Fatalf("markers = (%v, %v), want (false, true)", outAP[0].Marker, outAP[1].Marker)
	}
	if outAP[0].SequenceNumber != 15 || outAP[1].SequenceNumber != 16 {
		t.Fatalf("seqs = (%d, %d), want (15, 16)", outAP[0].SequenceNumber, outAP[1].SequenceNumber)
	}
}
