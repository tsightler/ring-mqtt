package main

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"testing"
	"time"

	"github.com/pion/rtp"
)

// quietReorder pins the budget by setting the floor and ceiling equal, so tests
// of the buffer mechanics are not disturbed by adaptation.
func quietReorder(wait time.Duration, max int) *reorderBuffer {
	return newReorderBuffer(log.New(&bytes.Buffer{}, "", 0), "video", wait, wait, max)
}

// adaptiveReorder allows the budget to move between the given bounds.
func adaptiveReorder(min, max time.Duration) *reorderBuffer {
	return newReorderBuffer(log.New(&bytes.Buffer{}, "", 0), "video", min, max, 64)
}

func seqs(pkts []*rtp.Packet) []uint16 {
	var out []uint16
	for _, p := range pkts {
		out = append(out, p.SequenceNumber)
	}
	return out
}

func eq(t *testing.T, got []uint16, want ...uint16) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// An undisturbed stream must pass straight through with no added latency.
func TestReorderPassesInOrderImmediately(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()
	for i := uint16(1); i <= 5; i++ {
		eq(t, seqs(b.push(pkt(i, false), now)), i)
	}
	if _, gaps, late, missing := b.counts(); gaps != 0 || late != 0 || missing != 0 {
		t.Fatalf("gaps=%d late=%d missing=%d on a clean stream", gaps, late, missing)
	}
}

// The whole point: a packet that arrives late but within the budget is put back
// in place and nothing is lost.
func TestReorderRepairsAGapWithinTheBudget(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()

	eq(t, seqs(b.push(pkt(1, false), now)), 1)
	// 2 is missing; 3 and 4 must be held rather than forwarded past it.
	if out := b.push(pkt(3, false), now); out != nil {
		t.Fatalf("forwarded %v while 2 was still outstanding", seqs(out))
	}
	if out := b.push(pkt(4, false), now); out != nil {
		t.Fatalf("forwarded %v while 2 was still outstanding", seqs(out))
	}
	// The retransmission lands 30ms later, inside the budget.
	eq(t, seqs(b.push(pkt(2, false), now.Add(30*time.Millisecond))), 2, 3, 4)

	repaired, gaps, _, missing := b.counts()
	if repaired != 1 || gaps != 0 || missing != 0 {
		t.Fatalf("repaired=%d gaps=%d missing=%d, want 1/0/0", repaired, gaps, missing)
	}
}

// If the repair never comes, the hole must be given up on so the stream keeps
// moving rather than stalling forever.
func TestReorderGivesUpAfterTheBudget(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()

	b.push(pkt(1, false), now)
	if out := b.push(pkt(3, false), now); out != nil {
		t.Fatalf("forwarded %v too early", seqs(out))
	}
	eq(t, seqs(b.expire(now.Add(150*time.Millisecond))), 3)

	_, gaps, _, missing := b.counts()
	if gaps != 1 || missing != 1 {
		t.Fatalf("gaps=%d missing=%d, want 1 and 1", gaps, missing)
	}
}

// A repair arriving after we gave up must not be forwarded out of order.
func TestReorderDropsRepairThatArrivesTooLate(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()

	b.push(pkt(1, false), now)
	b.push(pkt(3, false), now)
	b.expire(now.Add(150 * time.Millisecond)) // gives up on 2, emits 3

	if out := b.push(pkt(2, false), now.Add(200*time.Millisecond)); out != nil {
		t.Fatalf("forwarded %v after already moving past it", seqs(out))
	}
	if _, _, late, _ := b.counts(); late != 1 {
		t.Fatalf("late=%d, want 1", late)
	}
}

func TestReorderDropsDuplicates(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()
	b.push(pkt(1, false), now)
	b.push(pkt(3, false), now)
	if out := b.push(pkt(3, false), now); out != nil {
		t.Fatalf("forwarded a duplicate: %v", seqs(out))
	}
	if _, _, late, _ := b.counts(); late != 1 {
		t.Fatalf("late=%d, want 1", late)
	}
}

// A full buffer must release rather than grow without bound.
func TestReorderReleasesWhenFull(t *testing.T) {
	b := quietReorder(time.Hour, 4) // budget long enough that only capacity can force it
	now := time.Now()
	b.push(pkt(1, false), now)
	var out []*rtp.Packet
	for i := uint16(3); i <= 6; i++ {
		out = append(out, b.push(pkt(i, false), now)...)
	}
	if len(out) == 0 {
		t.Fatal("buffer grew past capacity without releasing anything")
	}
	if _, gaps, _, _ := b.counts(); gaps == 0 {
		t.Fatal("capacity release did not record a gap")
	}
}

// Wraparound is ordinary progress and must not look like a huge jump backwards.
func TestReorderHandlesWraparound(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()
	eq(t, seqs(b.push(pkt(65534, false), now)), 65534)
	eq(t, seqs(b.push(pkt(65535, false), now)), 65535)
	eq(t, seqs(b.push(pkt(0, false), now)), 0)
	eq(t, seqs(b.push(pkt(1, false), now)), 1)
	if _, gaps, late, _ := b.counts(); gaps != 0 || late != 0 {
		t.Fatalf("gaps=%d late=%d across a wrap, want 0/0", gaps, late)
	}
}

// Out of order arrival across the wrap boundary must still be reassembled.
func TestReorderRepairsAcrossWraparound(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()
	eq(t, seqs(b.push(pkt(65535, false), now)), 65535)
	if out := b.push(pkt(1, false), now); out != nil {
		t.Fatalf("forwarded %v while 0 was outstanding", seqs(out))
	}
	eq(t, seqs(b.push(pkt(0, false), now)), 0, 1)
}

// A large discontinuity is a new stream position, not something to wait on.
func TestReorderResyncsOnLargeJump(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 8)
	now := time.Now()
	b.push(pkt(1, false), now)
	out := b.push(pkt(9000, false), now)
	eq(t, seqs(out), 9000)
}

// deadline drives the pump read timeout, so it must exist only while holding.
func TestReorderDeadlineOnlyWhileHolding(t *testing.T) {
	b := quietReorder(100*time.Millisecond, 64)
	now := time.Now()
	if _, ok := b.deadline(); ok {
		t.Fatal("deadline set with an empty buffer")
	}
	b.push(pkt(1, false), now)
	if _, ok := b.deadline(); ok {
		t.Fatal("deadline set while nothing is being held")
	}
	b.push(pkt(3, false), now)
	due, ok := b.deadline()
	if !ok {
		t.Fatal("no deadline while holding a gap open")
	}
	if want := now.Add(100 * time.Millisecond); !due.Equal(want) {
		t.Fatalf("deadline %v, want %v", due, want)
	}
}

// pionTimeout mimics the error pion returns when a read deadline expires: it
// prints as "i/o timeout" and reports Timeout(), but does not unwrap to
// os.ErrDeadlineExceeded. Treating it as a dead track killed live sessions.
type pionTimeout struct{}

func (pionTimeout) Error() string   { return "i/o timeout" }
func (pionTimeout) Timeout() bool   { return true }
func (pionTimeout) Temporary() bool { return true }

func TestIsReadTimeoutAcceptsPionsOwnError(t *testing.T) {
	if !isReadTimeout(pionTimeout{}) {
		t.Fatal("pion's timeout was not recognised; the session would be torn down")
	}
	if !isReadTimeout(os.ErrDeadlineExceeded) {
		t.Fatal("the standard deadline error was not recognised")
	}
	if !isReadTimeout(fmt.Errorf("wrapped: %w", pionTimeout{})) {
		t.Fatal("a wrapped timeout was not recognised")
	}
}

func TestIsReadTimeoutRejectsRealFailures(t *testing.T) {
	for _, err := range []error{io.EOF, errors.New("connection reset"), fmt.Errorf("wrapped: %w", io.EOF)} {
		if isReadTimeout(err) {
			t.Fatalf("%v was treated as a timeout; a dead track would be retried forever", err)
		}
	}
}

// A repair that arrives quickly must not inflate the budget: a camera on the
// local network should not pay for one on another continent.
func TestReorderKeepsBudgetLowForFastRepairs(t *testing.T) {
	b := adaptiveReorder(50*time.Millisecond, 400*time.Millisecond)
	now := time.Now()

	for i := 0; i < 10; i++ {
		base := uint16(i * 10)
		b.push(pkt(base+1, false), now)
		b.push(pkt(base+3, false), now)                         // hole at base+2
		b.push(pkt(base+2, false), now.Add(8*time.Millisecond)) // repaired in 8ms
		now = now.Add(time.Second)
	}
	if got := b.budget(); got != 50*time.Millisecond {
		t.Fatalf("budget grew to %v on 8ms repairs, want the 50ms floor", got)
	}
}

// A distant camera whose repairs consistently take ~200ms must have the budget
// grow to cover them, rather than abandoning every gap.
func TestReorderGrowsBudgetForDistantRepairs(t *testing.T) {
	b := adaptiveReorder(50*time.Millisecond, 400*time.Millisecond)
	now := time.Now()

	for i := 0; i < 12; i++ {
		base := uint16(i * 10)
		b.push(pkt(base+1, false), now)
		b.push(pkt(base+3, false), now) // hole at base+2 opens here
		// Nothing arrives in time, so the gap is abandoned...
		b.expire(now.Add(b.budget() + time.Millisecond))
		// ...and the repair turns up 200ms after the hole opened.
		b.push(pkt(base+2, false), now.Add(200*time.Millisecond))
		now = now.Add(time.Second)
	}

	got := b.budget()
	if got <= 100*time.Millisecond {
		t.Fatalf("budget stayed at %v despite 200ms repairs", got)
	}
	if got > 400*time.Millisecond {
		t.Fatalf("budget %v exceeded the ceiling", got)
	}
}

// The ceiling is the guarantee that latency stays bounded no matter how bad the
// path is.
func TestReorderBudgetRespectsTheCeiling(t *testing.T) {
	b := adaptiveReorder(50*time.Millisecond, 150*time.Millisecond)
	for i := 0; i < 20; i++ {
		b.observeRepair(2 * time.Second)
	}
	if got := b.budget(); got != 150*time.Millisecond {
		t.Fatalf("budget %v, want it clamped to the 150ms ceiling", got)
	}
}

func TestReorderBudgetRespectsTheFloor(t *testing.T) {
	b := adaptiveReorder(80*time.Millisecond, 400*time.Millisecond)
	for i := 0; i < 20; i++ {
		b.observeRepair(time.Millisecond)
	}
	if got := b.budget(); got != 80*time.Millisecond {
		t.Fatalf("budget %v, want it held at the 80ms floor", got)
	}
}
