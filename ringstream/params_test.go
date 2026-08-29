package main

import (
	"testing"

	"github.com/pion/rtp"
)

// nal builds a single NAL unit RTP packet of the given HEVC type.
func nal(t byte, body ...byte) *rtp.Packet {
	return &rtp.Packet{Payload: append([]byte{t << 1, 1}, body...)}
}

func newCollector() (*paramCollector, *videoSpec) {
	spec := &videoSpec{h265: true}
	return &paramCollector{h265: true, spec: spec}, spec
}

// The ordinary case: a clean run of VPS, SPS, PPS completes and holds exactly
// those three packets.
func TestParamCollectorTakesACleanRun(t *testing.T) {
	c, spec := newCollector()
	if c.offer(nal(h265VPS, 0xAA)) {
		t.Fatal("completed on the VPS alone")
	}
	if c.offer(nal(h265SPS, 0xBB)) {
		t.Fatal("completed without a PPS")
	}
	if !c.offer(nal(h265PPS, 0xCC)) {
		t.Fatal("did not complete on the PPS")
	}
	if len(c.held) != 3 {
		t.Fatalf("held %d packets, want 3", len(c.held))
	}
	if spec.vps == nil || spec.sps == nil || spec.pps == nil {
		t.Fatal("a set is missing after a complete run")
	}
}

// Joining midway through a run must not capture a partial set. This is the case
// that made streams open on undecodable data.
func TestParamCollectorIgnoresAPartialRun(t *testing.T) {
	c, _ := newCollector()

	// Arrive just after the VPS: SPS and PPS of a run we did not see the start of.
	if c.offer(nal(h265SPS, 0x11)) || c.offer(nal(h265PPS, 0x22)) {
		t.Fatal("completed from a run whose VPS was never seen")
	}
	if len(c.held) != 0 {
		t.Fatalf("held %d packets before any run began, want 0", len(c.held))
	}

	// Some slices go by, then the next keyframe's full run arrives.
	c.offer(nal(1, 0x33))
	c.offer(nal(h265VPS, 0xAA))
	c.offer(nal(h265SPS, 0xBB))
	if !c.offer(nal(h265PPS, 0xCC)) {
		t.Fatal("did not complete on the second, whole run")
	}
	if len(c.held) != 3 {
		t.Fatalf("held %d packets, want just the 3 of the complete run", len(c.held))
	}
	if c.spec.vps[2] != 0xAA || c.spec.sps[2] != 0xBB || c.spec.pps[2] != 0xCC {
		t.Fatal("kept sets from the partial run instead of the whole one")
	}
}

// A new run must discard whatever was held from an incomplete earlier one.
func TestParamCollectorRestartsOnANewRun(t *testing.T) {
	c, _ := newCollector()
	c.offer(nal(h265VPS, 0x01))
	c.offer(nal(h265SPS, 0x02))
	c.offer(nal(1, 0x03)) // a slice, run interrupted with no PPS

	if len(c.held) != 3 {
		t.Fatalf("held %d, want 3 before the restart", len(c.held))
	}
	c.offer(nal(h265VPS, 0xAA))
	if len(c.held) != 1 {
		t.Fatalf("held %d after a new run began, want 1", len(c.held))
	}
	if c.spec.sps != nil {
		t.Fatal("kept the SPS from the abandoned run")
	}
}

// Slices arriving before any run must never begin the held burst.
func TestParamCollectorSkipsLeadingSlices(t *testing.T) {
	c, _ := newCollector()
	for i := 0; i < 5; i++ {
		if c.offer(nal(1, byte(i))) {
			t.Fatal("completed on slices alone")
		}
	}
	if len(c.held) != 0 {
		t.Fatalf("held %d slices, want 0", len(c.held))
	}
	if c.complete() {
		t.Fatal("reported complete with no sets at all")
	}
}

// H.264 has no VPS, so the run is anchored on the SPS instead.
func TestParamCollectorAnchorsOnSPSForH264(t *testing.T) {
	spec := &videoSpec{}
	c := &paramCollector{h265: false, spec: spec}

	if c.offer(&rtp.Packet{Payload: []byte{8, 0x11}}) { // PPS before any SPS
		t.Fatal("completed from a PPS with no SPS")
	}
	if len(c.held) != 0 {
		t.Fatalf("held %d before an SPS, want 0", len(c.held))
	}
	if c.offer(&rtp.Packet{Payload: []byte{7, 0xAA}}) { // SPS
		t.Fatal("completed without a PPS")
	}
	if !c.offer(&rtp.Packet{Payload: []byte{8, 0xBB}}) { // PPS
		t.Fatal("did not complete on the PPS")
	}
	if len(c.held) != 2 {
		t.Fatalf("held %d packets, want 2", len(c.held))
	}
}

// The pre-roll drain relies on this: feeding a whole backlog through must leave
// the collector anchored on the newest complete run, not the oldest, and must
// hold only what follows it.
func TestParamCollectorKeepsTheNewestCompleteRun(t *testing.T) {
	c, spec := newCollector()

	// An older keyframe, complete, followed by its slices.
	c.offer(nal(h265VPS, 0x01))
	c.offer(nal(h265SPS, 0x02))
	if !c.offer(nal(h265PPS, 0x03)) {
		t.Fatal("first run did not complete")
	}
	for i := 0; i < 40; i++ {
		c.offer(nal(1, byte(i))) // a GOP of slices
	}
	if len(c.held) != 43 {
		t.Fatalf("held %d after the first GOP, want 43", len(c.held))
	}

	// The newest keyframe arrives; everything before it must be discarded.
	c.offer(nal(h265VPS, 0xAA))
	c.offer(nal(h265SPS, 0xBB))
	if !c.offer(nal(h265PPS, 0xCC)) {
		t.Fatal("second run did not complete")
	}
	c.offer(nal(1, 0xDD))

	if len(c.held) != 4 {
		t.Fatalf("held %d packets, want 4 (the newest run plus one slice)", len(c.held))
	}
	if spec.vps[2] != 0xAA || spec.sps[2] != 0xBB || spec.pps[2] != 0xCC {
		t.Fatal("kept the older run's parameter sets")
	}
}

// Once a run is complete, later packets must keep reporting complete so the
// drain loop can tell it is still safe to stop at the live edge.
func TestParamCollectorStaysCompleteAfterTheRun(t *testing.T) {
	c, _ := newCollector()
	c.offer(nal(h265VPS, 1))
	c.offer(nal(h265SPS, 2))
	c.offer(nal(h265PPS, 3))
	if !c.offer(nal(1, 4)) {
		t.Fatal("reported incomplete on a slice after a whole run")
	}
	if !c.complete() {
		t.Fatal("complete() disagreed with offer()")
	}
}
