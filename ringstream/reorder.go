package main

import (
	"errors"
	"log"
	"net"
	"os"
	"time"

	"github.com/pion/rtp"
)

// isReadTimeout reports whether a track read failed because the deadline the
// reorder buffer set expired, rather than because the track ended.
//
// pion does not return os.ErrDeadlineExceeded: it has its own error value that
// merely prints as "i/o timeout" and does not unwrap to the standard sentinel.
// Matching on the sentinel alone therefore treated every expiry as a dead track
// and tore the session down, which is what made streams die a few seconds in
// with nothing else wrong. Match on the net.Error timeout behaviour instead,
// which both spellings satisfy.
func isReadTimeout(err error) bool {
	if errors.Is(err, os.ErrDeadlineExceeded) {
		return true
	}
	var ne net.Error
	return errors.As(err, &ne) && ne.Timeout()
}

// reorderBuffer holds packets just long enough to put them back in order and to
// give a retransmission time to arrive.
//
// Ring answers the NACKs we send, but a relay that forwards every packet the
// instant it arrives has nowhere to put the repair when it turns up: the frame
// it belonged to left several frames ago. This is the thing a browser does
// differently, and it is why a browser survives loss that ends a session here.
// Holding a hole open briefly turns a retransmission we already ask for into one
// that can be used.
//
// A packet that arrives in order is released immediately, so the wait costs
// latency only while something is actually missing.
//
// Not internally synchronised: it is driven from one pump goroutine.
type reorderBuffer struct {
	lg   *log.Logger
	name string
	max  int

	// wait adapts to how long repairs actually take. A fixed budget is either
	// too short for a camera on another continent, where a NACK round trip runs
	// to a few hundred milliseconds, or needless latency for one on the LAN.
	// minWait and maxWait bound it.
	wait, minWait, maxWait time.Duration

	// Smoothed repair latency, estimated the way RFC 6298 estimates a
	// retransmission timeout: track the mean and the variation, and wait for the
	// mean plus four times the variation so an occasional slow repair does not
	// get abandoned.
	srtt, rttvar time.Duration
	haveSRTT     bool

	// abandoned remembers the holes given up on, so a repair that turns up too
	// late still measures how long it would have taken. That is the sample that
	// says the budget is short, and without it the estimate can never grow.
	abandoned []abandonedGap

	pkts    map[uint16]heldPacket
	next    uint16
	started bool

	repaired uint64
	gaps     uint64
	late     uint64
	missing  uint64
}

type heldPacket struct {
	pkt *rtp.Packet
	at  time.Time
}

// abandonedGap is a hole that timed out, kept so a later arrival can still be
// timed. Only a handful are retained; older ones stop being interesting.
type abandonedGap struct {
	start, end uint16 // inclusive range of missing sequence numbers
	openedAt   time.Time
}

const abandonedGapsKept = 8

func newReorderBuffer(lg *log.Logger, name string, minWait, maxWait time.Duration, max int) *reorderBuffer {
	return &reorderBuffer{
		lg:      orDefault(lg),
		name:    name,
		wait:    minWait,
		minWait: minWait,
		maxWait: maxWait,
		max:     max,
		pkts:    make(map[uint16]heldPacket, max),
	}
}

// observeRepair folds a measured repair latency into the budget.
func (b *reorderBuffer) observeRepair(d time.Duration) {
	if d <= 0 {
		return
	}
	if !b.haveSRTT {
		b.srtt, b.rttvar, b.haveSRTT = d, d/2, true
	} else {
		diff := b.srtt - d
		if diff < 0 {
			diff = -diff
		}
		b.rttvar = (3*b.rttvar + diff) / 4
		b.srtt = (7*b.srtt + d) / 8
	}

	want := b.srtt + 4*b.rttvar
	switch {
	case want < b.minWait:
		want = b.minWait
	case want > b.maxWait:
		want = b.maxWait
	}

	// Only mention a change worth noticing, so a settled stream stays quiet.
	if d := want - b.wait; d > 20*time.Millisecond || d < -20*time.Millisecond {
		b.lg.Printf("%s: repairs are taking %s, holding gaps for %s",
			b.name, b.srtt.Round(time.Millisecond), want.Round(time.Millisecond))
	}
	b.wait = want
}

// timeAbandoned reports how long a hole had been open when a packet belonging to
// an already abandoned gap finally arrived.
func (b *reorderBuffer) timeAbandoned(seq uint16, now time.Time) (time.Duration, bool) {
	for i, g := range b.abandoned {
		if seq-g.start <= g.end-g.start {
			b.abandoned = append(b.abandoned[:i], b.abandoned[i+1:]...)
			return now.Sub(g.openedAt), true
		}
	}
	return 0, false
}

func (b *reorderBuffer) rememberAbandoned(start, end uint16, openedAt time.Time) {
	b.abandoned = append(b.abandoned, abandonedGap{start: start, end: end, openedAt: openedAt})
	if len(b.abandoned) > abandonedGapsKept {
		b.abandoned = b.abandoned[len(b.abandoned)-abandonedGapsKept:]
	}
}

// push takes an arriving packet and returns whatever is now ready to forward, in
// sequence order.
func (b *reorderBuffer) push(pkt *rtp.Packet, now time.Time) []*rtp.Packet {
	if !b.started {
		b.started, b.next = true, pkt.SequenceNumber
	}

	delta := pkt.SequenceNumber - b.next

	// Behind the emit position: a repair that arrived after we gave up on it, or
	// a plain duplicate. Forwarding it now would only disturb the frame being
	// assembled downstream.
	if delta >= 0x8000 {
		b.late++
		// It came too late to use, but it still measures what the budget would
		// have needed to be. This is the only sample that can push the estimate
		// upwards, since a hole that fills in time never shows how much slack
		// was left.
		if d, ok := b.timeAbandoned(pkt.SequenceNumber, now); ok {
			b.observeRepair(d)
		}
		return nil
	}

	// A jump far beyond the window is a discontinuity in the stream rather than
	// reordering, so resynchronise instead of holding everything waiting for
	// packets that will never come.
	if int(delta) > b.max*4 {
		out := b.flushAll()
		b.next = pkt.SequenceNumber
		b.pkts[pkt.SequenceNumber] = heldPacket{pkt: pkt, at: now}
		return append(out, b.drain(now)...)
	}

	if _, dup := b.pkts[pkt.SequenceNumber]; dup {
		b.late++
		return nil
	}

	// Arriving exactly where the hole was, with packets already queued behind it,
	// is a hole being closed: either a retransmission or plain reordering. How
	// long it stood open is a direct measurement of repair latency.
	if delta == 0 && len(b.pkts) > 0 {
		b.repaired++
		if oldest, ok := b.oldestHeld(); ok {
			b.observeRepair(now.Sub(oldest))
		}
	}

	b.pkts[pkt.SequenceNumber] = heldPacket{pkt: pkt, at: now}
	return b.drain(now)
}

// expire releases what is due when no packet has arrived to drive things along.
func (b *reorderBuffer) expire(now time.Time) []*rtp.Packet { return b.drain(now) }

// drain emits the contiguous run from next, then gives up on a hole that has
// waited out its budget or that the buffer no longer has room to wait for.
func (b *reorderBuffer) drain(now time.Time) []*rtp.Packet {
	var out []*rtp.Packet
	for {
		for {
			h, ok := b.pkts[b.next]
			if !ok {
				break
			}
			delete(b.pkts, b.next)
			out = append(out, h.pkt)
			b.next++
		}

		if len(b.pkts) == 0 {
			return out
		}
		if !b.overdue(now) && len(b.pkts) < b.max {
			return out
		}

		lo := b.lowest()
		gone := lo - b.next
		b.gaps++
		b.missing += uint64(gone)
		if oldest, ok := b.oldestHeld(); ok {
			b.rememberAbandoned(b.next, lo-1, oldest)
		}
		if b.gaps <= 10 || b.gaps%100 == 0 {
			b.lg.Printf("%s: gave up on %d packets from seq %d after %s (%d gaps, %d repaired, %d late)",
				b.name, gone, b.next, b.wait.Round(time.Millisecond), b.gaps, b.repaired, b.late)
		}
		b.next = lo
	}
}

// oldestHeld reports when the earliest packet still being held arrived, which is
// when the hole in front of it opened.
func (b *reorderBuffer) oldestHeld() (time.Time, bool) {
	var oldest time.Time
	for _, h := range b.pkts {
		if oldest.IsZero() || h.at.Before(oldest) {
			oldest = h.at
		}
	}
	return oldest, !oldest.IsZero()
}

// deadline reports when the oldest held packet stops being worth waiting on.
func (b *reorderBuffer) deadline() (time.Time, bool) {
	oldest, ok := b.oldestHeld()
	if !ok {
		return time.Time{}, false
	}
	return oldest.Add(b.wait), true
}

func (b *reorderBuffer) overdue(now time.Time) bool {
	due, ok := b.deadline()
	return ok && !now.Before(due)
}

// lowest returns the held sequence number closest ahead of next. Everything held
// is ahead of it, so unsigned distance orders correctly across wraparound.
func (b *reorderBuffer) lowest() uint16 {
	var best uint16
	first := true
	for seq := range b.pkts {
		if first || seq-b.next < best-b.next {
			best, first = seq, false
		}
	}
	return best
}

// flushAll empties the buffer in sequence order, for a discontinuity or shutdown.
func (b *reorderBuffer) flushAll() []*rtp.Packet {
	var out []*rtp.Packet
	for len(b.pkts) > 0 {
		lo := b.lowest()
		out = append(out, b.pkts[lo].pkt)
		delete(b.pkts, lo)
		b.next = lo + 1
	}
	return out
}

// counts reports holes closed by a late arrival, holes given up on, packets that
// came back too late to use, and packets never recovered.
func (b *reorderBuffer) counts() (repaired, gaps, late, missing uint64) {
	return b.repaired, b.gaps, b.late, b.missing
}

// budget reports the wait currently in force, for logging and tests.
func (b *reorderBuffer) budget() time.Duration { return b.wait }
