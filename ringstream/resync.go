package main

import (
	"log"
	"time"

	"github.com/pion/rtp"
)

const (
	// pliRetryInterval bounds how often we ask Ring for a keyframe while waiting
	// to recover from an unrepairable gap, matching Chrome's PLI pacing so a
	// burst of lost packets does not flood the sender with keyframe requests.
	pliRetryInterval = 300 * time.Millisecond

	// maxFramePackets caps how many packets a single access unit may accumulate
	// before being flushed as a safety bound.
	maxFramePackets = 512
)

// videoResync assembles complete access units and, when a sequence gap cannot
// be repaired by the reorder buffer, discards any partial frame, requests an
// immediate keyframe via RTCP PLI, and holds output until a complete keyframe
// arrives.
//
// Emitting packets one by one before a frame is complete means a gap midway
// through a fragmented slice (or midway through a VPS/SPS/PPS/IDR keyframe run)
// leaves the first half of the broken frame already written to the RTSP stream.
// Hardware H.265 decoders handed a truncated slice or a predicted frame that
// references a missing picture can lock up rather than conceal the error.
// Holding each access unit until its slice finishes guarantees downstream
// decoders only ever see complete frames, while firing a PLI on loss recovers
// within one round trip (~100ms) instead of waiting out Ring's 2-second GOP.
//
// Sequence numbers are deliberately not rewritten so downstream RTP consumers
// still see the gap across dropped frames.
//
// Not internally synchronised: callers already serialise their writes.
type videoResync struct {
	lg     *log.Logger
	h265   bool
	onLoss func()

	have    bool
	lastSeq uint16

	// dropping runs from the moment an unrecovered gap is seen until a complete
	// keyframe access unit has been reassembled.
	dropping     bool
	gapSeq       uint16
	runDiscarded uint64
	lastPLI      time.Time

	// frame holds the contiguous packets of the current access unit until its
	// slice completes, so a gap midway through a frame discards the whole frame
	// rather than leaving its leading fragments in the stream.
	frame []*rtp.Packet
	inFU  bool

	gaps      uint64
	late      uint64
	discarded uint64
}

func (r *videoResync) discardFrame() uint64 {
	n := uint64(len(r.frame))
	if n > 0 {
		r.discarded += n
		r.runDiscarded += n
		r.frame = r.frame[:0]
	}
	r.inFU = false
	return n
}

func (r *videoResync) requestPLI(now time.Time) {
	if r.onLoss == nil {
		return
	}
	if !r.lastPLI.IsZero() && now.Sub(r.lastPLI) < pliRetryInterval {
		return
	}
	r.lastPLI = now
	r.onLoss()
}

// push feeds the next packet from the stream and returns the packets of a
// completed frame ready to forward, or nil while still assembling or dropping.
func (r *videoResync) push(pkt *rtp.Packet) []*rtp.Packet {
	return r.pushAt(pkt, time.Now())
}

func (r *videoResync) pushAt(pkt *rtp.Packet, now time.Time) []*rtp.Packet {
	info := inspectPayload(pkt.Payload, r.h265)

	if !r.have {
		r.have, r.lastSeq = true, pkt.SequenceNumber
	} else {
		delta := pkt.SequenceNumber - r.lastSeq

		// Behind the stream position: a retransmission that arrived after the
		// reorder buffer gave up on it, or a plain duplicate.
		if delta == 0 || delta >= 0x8000 {
			r.late++
			if r.late == 1 && r.lg != nil {
				r.lg.Printf("video: dropping packets that arrive behind the stream position, seq %d is behind %d",
					pkt.SequenceNumber, r.lastSeq)
			}
			return nil
		}

		r.lastSeq = pkt.SequenceNumber

		if delta > 1 {
			hadPartial := len(r.frame) > 0
			flushed := r.discardFrame()
			if !r.dropping {
				r.gaps++
				r.dropping = true
				r.gapSeq = pkt.SequenceNumber
				r.runDiscarded = flushed
			}
			r.requestPLI(now)

			// If we were midway through assembling a frame (for instance VPS+SPS
			// had arrived and PPS was lost right before the IDR slice), a packet
			// immediately after the gap that does not begin a fresh parameter-set
			// run belongs to the damaged access unit and must be discarded too.
			if hadPartial && !info.startsParamRun {
				r.discarded++
				r.runDiscarded++
				return nil
			}
		}
	}

	// Verify fragmentation unit continuity even when sequence numbers are
	// contiguous, so a malformed stream cannot leave an FU half-open.
	if r.inFU {
		if !info.isFU || info.fuStart {
			flushed := r.discardFrame()
			if !r.dropping {
				r.gaps++
				r.dropping = true
				r.gapSeq = pkt.SequenceNumber
				r.runDiscarded = flushed
			}
			r.requestPLI(now)
		}
	} else if info.isFU && !info.fuStart {
		// Middle or end fragment of an FU whose start was never seen.
		flushed := r.discardFrame()
		if !r.dropping {
			r.gaps++
			r.dropping = true
			r.gapSeq = pkt.SequenceNumber
			r.runDiscarded = flushed
		}
		r.discarded++
		r.runDiscarded++
		r.requestPLI(now)
		return nil
	}

	if r.dropping {
		if len(r.frame) == 0 {
			if !info.startsRAP {
				r.discarded++
				r.runDiscarded++
				r.requestPLI(now)
				return nil
			}
		} else if info.startsParamRun {
			// A new parameter-set run supersedes an earlier incomplete one.
			r.discardFrame()
		}
	}

	r.frame = append(r.frame, pkt)
	r.inFU = info.isFU && !info.fuEnd

	complete := !r.inFU && ((info.isVCL && (pkt.Header.Marker || pkt.Timestamp == 0)) || len(r.frame) >= maxFramePackets)
	if !complete {
		return nil
	}

	if r.dropping {
		r.dropping = false
		r.lastPLI = time.Time{}
		if r.lg != nil && (r.gaps <= 10 || r.gaps%100 == 0) {
			r.lg.Printf("video: gap at seq %d, discarded %d packets waiting for a keyframe (%d gaps, %d late so far)",
				r.gapSeq, r.runDiscarded, r.gaps, r.late)
		}
	}

	out := append([]*rtp.Packet(nil), r.frame...)
	r.frame = r.frame[:0]
	return out
}

// counts reports gaps seen, packets dropped for arriving late, and packets
// discarded while waiting for a complete keyframe.
func (r *videoResync) counts() (gaps, late, discarded uint64) {
	return r.gaps, r.late, r.discarded
}
