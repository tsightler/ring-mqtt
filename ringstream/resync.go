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
	frame            []*rtp.Packet
	inFU             bool
	frameSlices      int
	frameHasSliceHdr bool
	frameIsRAP       bool
	frameIsIRAP      bool
	frameTS          uint32
	frameHasTS       bool
	framePOC         uint
	frameHasPOC      bool
	lastSliceAddr    uint
	frameSliceAddrs  []uint

	// HEVC stream state learned from parameter sets and keyframes, used to
	// detect missing slices or dropped reference frames inside recorded MP4s
	// where ffmpeg re-packetizes with contiguous RTP sequence numbers.
	sps            hevcSPSInfo
	pps            hevcPPSInfo
	kfSlices       int
	kfSliceAddrs   []uint
	fixedSliceGrid bool
	havePOC        bool
	lastPOC        uint
	pocStep        uint

	gaps      uint64
	late      uint64
	discarded uint64
}

func (r *videoResync) resetFrameState() {
	r.inFU = false
	r.frameSlices = 0
	r.frameHasSliceHdr = false
	r.frameIsRAP = false
	r.frameIsIRAP = false
	r.frameTS = 0
	r.frameHasTS = false
	r.framePOC = 0
	r.frameHasPOC = false
	r.lastSliceAddr = 0
	r.frameSliceAddrs = r.frameSliceAddrs[:0]
}

func (r *videoResync) discardFrame() uint64 {
	n := uint64(len(r.frame))
	if n > 0 {
		r.discarded += n
		r.runDiscarded += n
		r.frame = r.frame[:0]
	}
	r.resetFrameState()
	return n
}

func (r *videoResync) triggerLoss(seq uint16, now time.Time) {
	flushed := r.discardFrame()
	if !r.dropping {
		r.gaps++
		r.dropping = true
		r.gapSeq = seq
		r.runDiscarded = flushed
	}
	r.requestPLI(now)
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

// seedH265Params pre-populates the SPS and PPS parsed from an RTSP SDP so
// slice headers can be validated even before in-band parameter sets arrive.
func (r *videoResync) seedH265Params(sps, pps []byte) {
	if parsed := hevcParseSPS(sps); parsed.valid {
		r.sps = parsed
	}
	if parsed := hevcParsePPS(pps); parsed.valid {
		r.pps = parsed
	}
}

// push feeds the next packet from the stream and returns the packets of a
// completed frame ready to forward, or nil while still assembling or dropping.
func (r *videoResync) push(pkt *rtp.Packet) []*rtp.Packet {
	return r.pushAt(pkt, time.Now())
}

func (r *videoResync) pushAt(pkt *rtp.Packet, now time.Time) []*rtp.Packet {
	if r.h265 {
		_, sps, pps := hevcParameterSets(pkt.Payload)
		if sps != nil {
			if parsed := hevcParseSPS(sps); parsed.valid {
				r.sps = parsed
			}
		}
		if pps != nil {
			if parsed := hevcParsePPS(pps); parsed.valid {
				r.pps = parsed
			}
		}
	}

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
			r.triggerLoss(pkt.SequenceNumber, now)

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
			r.triggerLoss(pkt.SequenceNumber, now)
		}
	} else if info.isFU && !info.fuStart {
		// Middle or end fragment of an FU whose start was never seen.
		r.triggerLoss(pkt.SequenceNumber, now)
		r.discarded++
		r.runDiscarded++
		return nil
	}

	// If a new frame begins while the previous access unit is still waiting for
	// its final marked slice, the previous frame was truncated.
	if r.frameSlices > 0 {
		tsChanged := r.frameHasTS && pkt.Timestamp != 0 && pkt.Timestamp != r.frameTS
		newPicSlice := r.h265 && info.vclStarts > 0 && info.hasSliceHdr && info.firstSliceInPic
		if tsChanged || info.startsParamRun || newPicSlice {
			r.triggerLoss(pkt.SequenceNumber, now)
		}
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

	// Validate HEVC slice headers when present so incomplete multi-slice frames
	// or dropped reference frames in recorded MP4s are caught even when ffmpeg
	// emits contiguous RTP sequence numbers.
	if r.h265 && info.vclStarts > 0 && info.hasSliceHdr {
		if r.frameSlices == 0 && !info.firstSliceInPic {
			// First slice of the picture is missing.
			r.triggerLoss(pkt.SequenceNumber, now)
			r.discarded++
			r.runDiscarded++
			return nil
		}
		if r.sps.valid && r.pps.valid {
			si := hevcInspectSlice(pkt.Payload, r.sps, r.pps)
			if !si.ok {
				r.triggerLoss(pkt.SequenceNumber, now)
				r.discarded++
				r.runDiscarded++
				return nil
			}
			if r.frameSlices == 0 {
				if !si.dependent {
					if !info.isIRAP && !r.frameIsRAP && r.havePOC && r.sps.maxNumReorderPics == 0 {
						mask := (uint(1) << r.sps.log2MaxPicOrderCnt) - 1
						deltaPOC := (si.poc - r.lastPOC) & mask
						if deltaPOC == 0 || (r.pocStep > 0 && deltaPOC != r.pocStep) || (r.pocStep == 0 && deltaPOC > 4) {
							r.triggerLoss(pkt.SequenceNumber, now)
							r.discarded++
							r.runDiscarded++
							return nil
						}
					}
					r.framePOC = si.poc
					r.frameHasPOC = true
				}
				r.lastSliceAddr = 0
			} else {
				if si.sliceAddr <= r.lastSliceAddr || (!si.dependent && r.frameHasPOC && si.poc != r.framePOC) {
					r.triggerLoss(pkt.SequenceNumber, now)
					r.discarded++
					r.runDiscarded++
					return nil
				}
				r.lastSliceAddr = si.sliceAddr
			}
			r.frameSliceAddrs = append(r.frameSliceAddrs, si.sliceAddr)
		}
	}

	if info.startsRAP {
		r.frameIsRAP = true
	}
	if info.isIRAP {
		r.frameIsIRAP = true
	}
	if info.vclStarts > 0 {
		if r.frameSlices == 0 && pkt.Timestamp != 0 {
			r.frameTS = pkt.Timestamp
			r.frameHasTS = true
		}
		r.frameSlices += info.vclStarts
		if info.hasSliceHdr {
			r.frameHasSliceHdr = true
		}
	}

	r.frame = append(r.frame, pkt)
	r.inFU = info.isFU && !info.fuEnd

	complete := !r.inFU && ((info.isVCL && (pkt.Header.Marker || pkt.Timestamp == 0)) || len(r.frame) >= maxFramePackets)
	if !complete {
		return nil
	}

	if r.h265 && r.frameHasSliceHdr {
		if r.frameIsIRAP || r.frameIsRAP {
			if r.kfSlices != r.frameSlices || !uintSlicesEqual(r.kfSliceAddrs, r.frameSliceAddrs) {
				r.kfSlices = r.frameSlices
				r.kfSliceAddrs = append(r.kfSliceAddrs[:0], r.frameSliceAddrs...)
				r.fixedSliceGrid = false
			}
		} else if r.kfSlices > 0 {
			if len(r.kfSliceAddrs) > 0 && len(r.frameSliceAddrs) == r.frameSlices {
				// When slice_segment_address is parsed from SPS/PPS, check if
				// any non-first slice lands on one of the keyframe's fixed CTB
				// row boundaries. That distinguishes a fixed-grid encoder from
				// one that slices dynamically by byte size.
				if uintSlicesEqual(r.frameSliceAddrs, r.kfSliceAddrs) || sharesGridBoundary(r.frameSliceAddrs, r.kfSliceAddrs) {
					r.fixedSliceGrid = true
				}
				if r.fixedSliceGrid && !uintSlicesEqual(r.frameSliceAddrs, r.kfSliceAddrs) {
					r.triggerLoss(pkt.SequenceNumber, now)
					return nil
				}
			} else {
				if r.frameSlices == r.kfSlices || r.frameSlices > 1 {
					r.fixedSliceGrid = true
				}
				if r.fixedSliceGrid && r.frameSlices != r.kfSlices {
					r.triggerLoss(pkt.SequenceNumber, now)
					return nil
				}
			}
		}
	}

	if r.h265 && r.frameHasPOC {
		if r.frameIsIRAP || r.frameIsRAP || !r.havePOC {
			r.havePOC = true
			r.lastPOC = r.framePOC
			r.pocStep = 0
		} else if r.sps.maxNumReorderPics == 0 {
			mask := (uint(1) << r.sps.log2MaxPicOrderCnt) - 1
			step := (r.framePOC - r.lastPOC) & mask
			if r.pocStep == 0 {
				r.pocStep = step
			}
			r.lastPOC = r.framePOC
		}
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
	r.resetFrameState()
	return out
}

// counts reports gaps seen, packets dropped for arriving late, and packets
// discarded while waiting for a complete keyframe.
func (r *videoResync) counts() (gaps, late, discarded uint64) {
	return r.gaps, r.late, r.discarded
}

func uintSlicesEqual(a, b []uint) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// sharesGridBoundary reports whether any non-first slice in frameAddrs starts
// on one of the keyframe's non-first CTB slice boundaries, indicating the
// encoder partitions frames along a fixed CTB grid rather than by byte size.
func sharesGridBoundary(frameAddrs, kfAddrs []uint) bool {
	for _, fa := range frameAddrs[1:] {
		if fa == 0 {
			continue
		}
		for _, ka := range kfAddrs[1:] {
			if fa == ka {
				return true
			}
		}
	}
	return false
}

