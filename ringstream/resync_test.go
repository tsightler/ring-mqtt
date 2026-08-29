package main

import (
	"bytes"
	"log"
	"testing"

	"github.com/pion/rtp"
)

func quietResync() *videoResync {
	return &videoResync{lg: log.New(&bytes.Buffer{}, "", 0), h265: true}
}

// pkt builds a bare packet, for tests that only care about sequence numbers.
func pkt(seq uint16, marker bool) *rtp.Packet {
	return &rtp.Packet{Header: rtp.Header{SequenceNumber: seq, Marker: marker}}
}

// rpkt builds a packet carrying one HEVC NAL unit of the given type, so the
// resync can tell a keyframe from a predicted frame.
func rpkt(seq uint16, nalType byte) *rtp.Packet {
	return &rtp.Packet{
		Header:  rtp.Header{SequenceNumber: seq},
		Payload: []byte{nalType << 1, 1},
	}
}

const (
	nalP  = 1       // predicted slice, not a random access point
	nalKF = h265VPS // starts a parameter set run, which is
	nalI  = 19      // IRAP slice, also a random access point
)

func feed(r *videoResync, in []*rtp.Packet) []uint16 {
	var out []uint16
	for _, p := range in {
		if got := r.filter(p); got != nil {
			out = append(out, got.SequenceNumber)
		}
	}
	return out
}

func eqSeq(t *testing.T, got []uint16, want ...uint16) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("forwarded %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("forwarded %v, want %v", got, want)
		}
	}
}

func TestResyncPassesAnUnbrokenStream(t *testing.T) {
	r := quietResync()
	eqSeq(t, feed(r, []*rtp.Packet{rpkt(1, nalKF), rpkt(2, nalP), rpkt(3, nalP), rpkt(4, nalP)}), 1, 2, 3, 4)
	if gaps, late, disc := r.counts(); gaps != 0 || late != 0 || disc != 0 {
		t.Fatalf("gaps=%d late=%d discarded=%d on a clean stream", gaps, late, disc)
	}
}

// The point of the change: after a gap, predicted frames reference pictures that
// are gone, so nothing may be forwarded until a keyframe arrives.
func TestResyncWaitsForAKeyframeAfterAGap(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(1, nalKF), rpkt(2, nalP),
		/* 3,4,5 lost */
		rpkt(6, nalP), rpkt(7, nalP), rpkt(8, nalP), // undecodable, must be dropped
		rpkt(9, nalKF), rpkt(10, nalP), // keyframe: forwarding resumes here
	})
	eqSeq(t, got, 1, 2, 9, 10)

	gaps, _, disc := r.counts()
	if gaps != 1 || disc != 3 {
		t.Fatalf("gaps=%d discarded=%d, want 1 and 3", gaps, disc)
	}
}

// An IRAP slice is as good a resume point as a parameter set run.
func TestResyncResumesOnAnIRAPSlice(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(1, nalKF) /* 2 lost */, rpkt(3, nalP), rpkt(4, nalI), rpkt(5, nalP),
	})
	eqSeq(t, got, 1, 4, 5)
}

// A retransmission arriving behind the position must not be forwarded and must
// not be mistaken for a gap, which would cost another keyframe wait.
func TestResyncDropsLatePacketWithoutTriggeringAGap(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(10, nalKF), rpkt(11, nalP), rpkt(12, nalP),
		rpkt(5, nalP), // retransmission, long past
		rpkt(13, nalP),
	})
	eqSeq(t, got, 10, 11, 12, 13)
	if gaps, late, _ := r.counts(); gaps != 0 || late != 1 {
		t.Fatalf("gaps=%d late=%d, want 0 and 1", gaps, late)
	}
}

func TestResyncDropsDuplicates(t *testing.T) {
	r := quietResync()
	eqSeq(t, feed(r, []*rtp.Packet{rpkt(1, nalKF), rpkt(1, nalKF), rpkt(2, nalP)}), 1, 2)
	if _, late, _ := r.counts(); late != 1 {
		t.Fatalf("late=%d, want 1", late)
	}
}

// Sequence numbers must survive untouched: hiding a gap is worse than showing it
// to a consumer that handles loss properly.
func TestResyncNeverRewritesSequenceNumbers(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(100, nalKF), rpkt(101, nalP),
		/* 102 lost */ rpkt(103, nalKF), rpkt(104, nalP),
	})
	eqSeq(t, got, 100, 101, 103, 104)
}

func TestResyncHandlesSequenceWraparound(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(65534, nalKF), rpkt(65535, nalP), rpkt(0, nalP), rpkt(1, nalP),
	})
	eqSeq(t, got, 65534, 65535, 0, 1)
	if gaps, late, _ := r.counts(); gaps != 0 || late != 0 {
		t.Fatalf("gaps=%d late=%d across a wrap, want 0/0", gaps, late)
	}
}

// A gap that runs to the end of the stream must not forward anything further.
func TestResyncStaysShutWithoutAKeyframe(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(1, nalKF), /* 2 lost */
		rpkt(3, nalP), rpkt(4, nalP), rpkt(5, nalP), rpkt(6, nalP),
	})
	eqSeq(t, got, 1)
	if _, _, disc := r.counts(); disc != 4 {
		t.Fatalf("discarded=%d, want 4", disc)
	}
}
