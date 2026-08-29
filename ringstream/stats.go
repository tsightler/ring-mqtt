package main

import (
	"bytes"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pion/rtp"
)

// trackStats records what is actually arriving on a track, so problems can be
// attributed to the stream rather than guessed at from player behaviour.
type trackStats struct {
	lg *log.Logger

	name      string
	video     bool
	h264      bool
	clockRate float64

	mu      sync.Mutex
	packets uint64
	// bytes since the last report, for the rate. What Ring sends us is not what
	// a browser three hops away can necessarily receive, and nothing in this
	// chain can ask Ring to slow down, so the actual rate matters.
	bytes      uint64
	lastReport time.Time

	// How Ring packetises HEVC. go2rtc's H.265 depacketiser handles only
	// fragmentation units and single NAL units: it has no case for aggregation
	// packets, which fall through and are appended verbatim, header bytes and
	// all, producing a corrupt access unit. Its H.264 path uses pion's
	// depayloader instead, which handles aggregation properly, so this is
	// worth counting before assuming anything.
	nalSingle uint64
	nalAP     uint64
	nalFU     uint64

	// Which NAL types actually arrive, counted separately for whole packets and
	// for the payload inside a fragmentation unit. Knowing the mix is the
	// difference between reasoning about this stream and guessing at it.
	nalTypes    map[byte]uint64
	nalMarked   map[byte]uint64
	lost        uint64
	gaps        uint64
	reordered   uint64
	biggestGap  uint16
	padded      uint64
	extended    uint64
	marked      uint64
	tsJumps     uint64
	keyframes   uint64
	spsChanges  uint64
	spsCosmetic uint64

	opusFrameMS float64
	opusFrames  int
	opusLogged  bool

	haveFirst bool
	firstWall time.Time
	firstTS   uint32

	ssrc        uint32
	haveSSRC    bool
	ssrcChanges uint64

	haveSeq bool
	lastSeq uint16
	lastTS  uint32
	lastSPS []byte
}

func (s *trackStats) observe(pkt *rtp.Packet) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.packets++
	s.bytes += uint64(len(pkt.Payload) + 12)
	if !s.haveFirst {
		s.haveFirst = true
		s.firstWall = time.Now()
		s.firstTS = pkt.Timestamp
	}
	if pkt.Header.Padding {
		s.padded++
	}
	if pkt.Header.Extension {
		s.extended++
	}
	if pkt.Header.Marker {
		s.marked++
	}

	if !s.haveSSRC {
		s.haveSSRC, s.ssrc = true, pkt.SSRC
	} else if pkt.SSRC != s.ssrc {
		// A new SSRC restarts sequence numbering; counting the jump as loss
		// would be meaningless.
		s.ssrcChanges++
		s.lg.Printf("%s: SSRC changed %d -> %d", s.name, s.ssrc, pkt.SSRC)
		s.ssrc = pkt.SSRC
		s.haveSeq = false
	}

	if !s.haveSeq {
		s.haveSeq = true
		s.lastSeq = pkt.SequenceNumber
		s.lastTS = pkt.Timestamp
	} else if gap := pkt.SequenceNumber - s.lastSeq; gap == 0 || gap >= 0x8000 {
		// Arrived after a packet with a higher number: a retransmission answering
		// a NACK, or plain reordering. It is not loss, and the position must not
		// advance for it either. Treating it as the new position makes the next
		// live packet look like a gap of everything in between, which is how a
		// handful of late packets used to report as tens of thousands lost.
		s.reordered++
	} else {
		if gap > 1 {
			s.lost += uint64(gap - 1)
			s.gaps++
			if gap > s.biggestGap {
				s.biggestGap = gap
			}
			if gap > 100 {
				s.lg.Printf("%s: sequence jumped %d -> %d, counting %d as lost",
					s.name, s.lastSeq, pkt.SequenceNumber, gap-1)
			}
		}
		// An audio timestamp step well beyond one frame means a gap in the
		// stream, which is what DTX (silence suppression) looks like.
		if !s.video && pkt.Timestamp-s.lastTS > 2880 {
			s.tsJumps++
		}
		s.lastSeq = pkt.SequenceNumber
		s.lastTS = pkt.Timestamp
	}

	if !s.video && !s.opusLogged {
		if ms, n, splittable, ok := opusFraming(pkt.Payload); ok {
			s.opusFrameMS, s.opusFrames = ms, n
			s.opusLogged = true
			s.lg.Printf("%s: opus framing %.1fms x %d frames per packet (%.1fms total), splittable=%t",
				s.name, ms, n, ms*float64(n), splittable)
		}
	}

	if s.video && !s.h264 && len(pkt.Payload) > 0 {
		if s.nalTypes == nil {
			s.nalTypes = map[byte]uint64{}
			s.nalMarked = map[byte]uint64{}
		}
		nal := (pkt.Payload[0] >> 1) & 0x3F
		switch {
		case nal == 48:
			s.nalAP++
		case nal == 49:
			s.nalFU++
			// Only the first fragment names the type it is carrying.
			if len(pkt.Payload) > 2 && pkt.Payload[2]&0x80 != 0 {
				inner := pkt.Payload[2] & 0x3F
				s.nalTypes[inner]++
				if pkt.Header.Marker {
					s.nalMarked[inner]++
				}
			}
		default:
			s.nalSingle++
			s.nalTypes[nal]++
			if pkt.Header.Marker {
				s.nalMarked[nal]++
			}
		}
	}

	if s.video {
		// Both codecs carry an SPS with every keyframe, so this doubles as a
		// keyframe counter and as detection of a mid-stream format change.
		var sps []byte
		resolution := spsResolution
		if s.h264 {
			sps, _ = scanParameterSets(pkt.Payload)
		} else {
			sps = hevcExtractSPS(pkt.Payload)
			resolution = hevcResolution
		}

		if sps != nil {
			s.keyframes++
			if s.lastSPS != nil && !bytes.Equal(s.lastSPS, sps) {
				s.spsChanges++
				ow, oh, ook := resolution(s.lastSPS)
				nw, nh, nok := resolution(sps)
				switch {
				case ook && nok && ow == nw && oh == nh:
					s.spsCosmetic++
					s.lg.Printf("%s: SPS changed but resolution is still %dx%d (cosmetic)", s.name, nw, nh)
				case ook && nok:
					s.lg.Printf("%s: resolution changed %dx%d -> %dx%d", s.name, ow, oh, nw, nh)
				default:
					s.lg.Printf("%s: SPS changed (could not parse resolution)", s.name)
				}
			}
			s.lastSPS = sps
		}
	}
}

func (s *trackStats) report() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.packets == 0 {
		return
	}
	// Media time divided by wall time. Sustained values above 1.0 mean the
	// source is handing us buffered media faster than it was captured.
	pace := 0.0
	if s.haveFirst && s.clockRate > 0 {
		if wall := time.Since(s.firstWall).Seconds(); wall > 0 {
			pace = (float64(s.lastTS-s.firstTS) / s.clockRate) / wall
		}
	}

	// Rate since the previous report rather than an average, so a burst is
	// visible instead of being smoothed away.
	rate := 0.0
	now := time.Now()
	if !s.lastReport.IsZero() {
		if elapsed := now.Sub(s.lastReport).Seconds(); elapsed > 0 {
			rate = float64(s.bytes) * 8 / elapsed / 1000000
		}
	}
	s.lastReport, s.bytes = now, 0

	if s.video {
		s.lg.Printf("%s: pkts=%d lost=%d padding=%d ext=%d marker=%d keyframes=%d spsChanges=%d pace=%.3fx rate=%.2fMbps",
			s.name, s.packets, s.lost, s.padded, s.extended, s.marked, s.keyframes, s.spsChanges, pace, rate)
		s.reportGaps()
		s.reportReordered()
		if s.nalAP > 0 || s.nalFU > 0 || s.nalSingle > 0 {
			s.lg.Printf("%s: hevc packets single=%d aggregation=%d fragmentation=%d",
				s.name, s.nalSingle, s.nalAP, s.nalFU)
			s.lg.Printf("%s: hevc nal types %s", s.name, describeNALs(s.nalTypes, s.nalMarked))
		}
		if s.spsCosmetic > 0 {
			s.lg.Printf("%s: spsCosmetic=%d of %d changes", s.name, s.spsCosmetic, s.spsChanges)
		}
		if s.ssrcChanges > 0 {
			s.lg.Printf("%s: ssrcChanges=%d", s.name, s.ssrcChanges)
		}
	} else {
		s.lg.Printf("%s: pkts=%d lost=%d padding=%d ext=%d marker=%d tsGaps=%d framing=%.1fmsx%d pace=%.3fx rate=%.2fMbps",
			s.name, s.packets, s.lost, s.padded, s.extended, s.marked, s.tsJumps,
			s.opusFrameMS, s.opusFrames, pace, rate)
		s.reportGaps()
		s.reportReordered()
	}
}

// Distinguishes a stream that is dropping the odd packet from one that took a
// single large sequence jump, which the loss total on its own cannot show.
func (s *trackStats) reportGaps() {
	if s.gaps == 0 {
		return
	}
	s.lg.Printf("%s: loss spread over %d gaps, largest %d packets", s.name, s.gaps, s.biggestGap-1)
}

// Late packets are reported apart from loss because they mean the opposite: the
// data arrived, just too late for a consumer that cannot reorder.
func (s *trackStats) reportReordered() {
	if s.reordered == 0 {
		return
	}
	s.lg.Printf("%s: %d packets arrived out of order or duplicated", s.name, s.reordered)
}

// hevcNALName covers the types that actually turn up in a camera stream; the
// rest are reported by number.
func hevcNALName(t byte) string {
	switch {
	case t <= 9:
		return "slice"
	case t >= 16 && t <= 21:
		return "keyframe-slice"
	case t == 32:
		return "vps"
	case t == 33:
		return "sps"
	case t == 34:
		return "pps"
	case t == 35:
		return "aud"
	case t == 39:
		return "prefix-sei"
	case t == 40:
		return "suffix-sei"
	}
	return "type" + strconv.Itoa(int(t))
}

// describeNALs renders the census, flagging any type that arrives carrying the
// marker bit. go2rtc's HEVC depacketiser discards a marked SEI without
// advancing its sequence counter, which costs both the frame being assembled
// and the one after it, so that combination is worth seeing.
func describeNALs(counts, marked map[byte]uint64) string {
	types := make([]int, 0, len(counts))
	for t := range counts {
		types = append(types, int(t))
	}
	sort.Ints(types)

	parts := make([]string, 0, len(types))
	for _, t := range types {
		part := fmt.Sprintf("%s(%d)=%d", hevcNALName(byte(t)), t, counts[byte(t)])
		if m := marked[byte(t)]; m > 0 {
			part += fmt.Sprintf(" marked=%d", m)
		}
		parts = append(parts, part)
	}
	return strings.Join(parts, " ")
}

func reportEvery(d time.Duration, stop <-chan struct{}, all ...*trackStats) {
	t := time.NewTicker(d)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			for _, s := range all {
				s.report()
			}
		}
	}
}
