package main

import (
	"bytes"
	"log"
	"testing"
	"time"

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

// fupkt builds an HEVC fragmentation unit packet carrying a slice of innerType.
func fupkt(seq uint16, innerType byte, start, end, marker bool) *rtp.Packet {
	fuHdr := innerType & 0x3F
	if start {
		fuHdr |= 0x80
	}
	if end {
		fuHdr |= 0x40
	}
	return &rtp.Packet{
		Header:  rtp.Header{SequenceNumber: seq, Marker: marker, Timestamp: 9000},
		Payload: []byte{h265FU << 1, 1, fuHdr, 0xAA},
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
		for _, got := range r.push(p) {
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
		rpkt(1, nalI) /* 2 lost */, rpkt(3, nalP), rpkt(4, nalI), rpkt(5, nalP),
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
		rpkt(1, nalI), /* 2 lost */
		rpkt(3, nalP), rpkt(4, nalP), rpkt(5, nalP), rpkt(6, nalP),
	})
	eqSeq(t, got, 1)
	if _, _, disc := r.counts(); disc != 4 {
		t.Fatalf("discarded=%d, want 4", disc)
	}
}

// Hardware H.265 decoders lock up if handed the leading fragments of a frame
// whose tail went missing. Holding the frame until its final fragment arrives
// ensures the damaged frame is discarded whole.
func TestResyncDiscardsIncompleteFragmentedFrameOnGap(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(1, nalI),
		// A 3-packet fragmented P-frame (2, 3, 4) where packet 3 is lost:
		fupkt(2, nalP, true, false, false),
		/* 3 lost */
		fupkt(4, nalP, false, true, true),
		// Next complete keyframe:
		rpkt(5, h265VPS), rpkt(6, h265SPS), rpkt(7, h265PPS),
		fupkt(8, nalI, true, false, false),
		fupkt(9, nalI, false, true, true),
	})
	// Packet 2 (the start of the broken P-frame) must never have been emitted.
	eqSeq(t, got, 1, 5, 6, 7, 8, 9)
}

// Losing a packet midway through a recovery keyframe (e.g. PPS lost between
// SPS and IDR, or a fragment of the IDR lost) must discard the partial keyframe
// rather than emit half of it to the decoder.
func TestResyncDiscardsIncompleteKeyframeRunOnGap(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(1, nalI),
		/* 2 lost */
		rpkt(3, nalP),
		// First recovery attempt loses PPS (seq 6) right before the IDR slice:
		rpkt(4, h265VPS), rpkt(5, h265SPS), /* 6 (PPS) lost */
		rpkt(7, nalI),
		rpkt(8, nalP),
		// Second recovery attempt is complete:
		rpkt(9, h265VPS), rpkt(10, h265SPS), rpkt(11, h265PPS), rpkt(12, nalI),
	})
	eqSeq(t, got, 1, 9, 10, 11, 12)
}

// If VPS was the packet lost in the gap, arriving SPS and PPS packets belong to
// an incomplete parameter-set run and must not open the gate early.
func TestResyncIgnoresOrphanedSPSAndPPSWhenVPSLost(t *testing.T) {
	r := quietResync()
	got := feed(r, []*rtp.Packet{
		rpkt(1, nalI),
		/* 2 (VPS) lost */
		rpkt(3, h265SPS), rpkt(4, h265PPS), rpkt(5, nalP),
		rpkt(6, h265VPS), rpkt(7, h265SPS), rpkt(8, h265PPS), rpkt(9, nalI),
	})
	eqSeq(t, got, 1, 6, 7, 8, 9)
}

// When a gap cannot be repaired, resync must request a keyframe immediately via
// PLI and retry at the configured interval until a complete keyframe arrives.
func TestResyncRequestsPLIOnLossAndRetriesWithRateLimit(t *testing.T) {
	plis := 0
	r := quietResync()
	r.onLoss = func() { plis++ }

	now := time.Now()
	r.pushAt(rpkt(1, nalI), now)
	if plis != 0 {
		t.Fatalf("plis=%d on clean stream, want 0", plis)
	}

	// Gap at seq 3 triggers an immediate PLI.
	r.pushAt(rpkt(3, nalP), now)
	if plis != 1 {
		t.Fatalf("plis=%d on initial gap, want 1", plis)
	}

	// Packets arriving inside the cooldown window must not flood PLIs.
	r.pushAt(rpkt(4, nalP), now.Add(50*time.Millisecond))
	r.pushAt(rpkt(5, nalP), now.Add(200*time.Millisecond))
	if plis != 1 {
		t.Fatalf("plis=%d during cooldown, want 1", plis)
	}

	// Still waiting after the retry interval: send another PLI.
	r.pushAt(rpkt(6, nalP), now.Add(pliRetryInterval+10*time.Millisecond))
	if plis != 2 {
		t.Fatalf("plis=%d after retry interval, want 2", plis)
	}

	// Complete keyframe recovers; subsequent P-frames do not trigger PLIs.
	r.pushAt(rpkt(7, nalI), now.Add(400*time.Millisecond))
	r.pushAt(rpkt(8, nalP), now.Add(800*time.Millisecond))
	if plis != 2 {
		t.Fatalf("plis=%d after recovery, want 2", plis)
	}
}
