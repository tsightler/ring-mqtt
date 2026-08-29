package main

import (
	"log"

	"github.com/pion/rtp"
)

// videoResync drops the remainder of an access unit once packets belonging to it
// have gone missing, so that nothing downstream is handed a frame it cannot
// assemble in full.
//
// A visible gap on its own is survivable: a consumer that sees one discards what
// it was assembling and picks up at the next frame. The danger is a consumer
// that cannot see it. ffmpeg re-packetizes with its own contiguous sequence
// numbers, so a frame that reached it incomplete leaves it as a structurally
// perfect RTP stream carrying a corrupt access unit. Everything after that
// believes the frame is whole, hands it to a hardware decoder, and the decoder
// does not survive it -- while no counter anywhere reports loss, because by that
// point there is none. A single dropped packet has been enough to end a session.
//
// Dropping forward to the next access unit boundary costs the damaged frame,
// which was unusable anyway, and nothing else.
//
// Sequence numbers are deliberately not rewritten. Closing the gap would hide
// the loss from consumers that do handle it correctly, which is worse than
// leaving it visible.
//
// Not internally synchronised: callers already serialise their writes.
type videoResync struct {
	lg   *log.Logger
	h265 bool

	have    bool
	lastSeq uint16

	// dropping runs from the moment a gap is seen to the end of the access unit
	// it damaged.
	dropping     bool
	gapSeq       uint16
	runDiscarded uint64

	gaps      uint64
	late      uint64
	discarded uint64
}

// filter returns the packet to forward, or nil to drop it.
func (r *videoResync) filter(pkt *rtp.Packet) *rtp.Packet {
	if !r.have {
		r.have, r.lastSeq = true, pkt.SequenceNumber
		return pkt
	}

	delta := pkt.SequenceNumber - r.lastSeq

	// Behind the stream position: a retransmission answering a NACK, or a plain
	// duplicate. Whatever it repairs, the consumer has already moved past the
	// frame it belonged to, so feeding it in now only destroys the frame being
	// assembled now. It must also not be mistaken for a gap.
	if delta == 0 || delta >= 0x8000 {
		r.late++
		if r.late == 1 {
			r.lg.Printf("video: dropping packets that arrive behind the stream position, seq %d is behind %d",
				pkt.SequenceNumber, r.lastSeq)
		}
		return nil
	}

	if delta > 1 && !r.dropping {
		r.gaps++
		r.dropping = true
		r.gapSeq = pkt.SequenceNumber
		r.runDiscarded = 0
	}

	r.lastSeq = pkt.SequenceNumber

	if !r.dropping {
		return pkt
	}

	// Resuming at the next access unit boundary is not enough: every frame after
	// a gap references pictures that went missing with it, and a hardware decoder
	// handed those dies rather than degrading. A browser given the same gap waits
	// for a keyframe instead, which is why it survives loss that ends a session
	// here. Wait for one too. The cost is a freeze of up to one GOP, which is what
	// a browser shows in the same situation.
	if isRandomAccessPoint(pkt.Payload, r.h265) {
		r.dropping = false
		if r.gaps <= 10 || r.gaps%100 == 0 {
			r.lg.Printf("video: gap at seq %d, discarded %d packets waiting for a keyframe (%d gaps, %d late so far)",
				r.gapSeq, r.runDiscarded, r.gaps, r.late)
		}
		return pkt
	}

	r.discarded++
	r.runDiscarded++
	return nil
}

// counts reports gaps seen, packets dropped for arriving late, and packets
// discarded to reach an access unit boundary.
func (r *videoResync) counts() (gaps, late, discarded uint64) {
	return r.gaps, r.late, r.discarded
}
