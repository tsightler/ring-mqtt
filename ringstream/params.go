package main

import "github.com/pion/rtp"

// paramCollector gathers the parameter sets an RTSP description needs, together
// with the packets they arrived in so the keyframe they belong to can be
// replayed rather than lost.
//
// It must begin at the head of a parameter set run. Ring sends VPS, SPS and PPS
// as three separate packets and flags every one of them as a random access
// point, so starting at the first flagged packet can begin midway through a run
// and capture only part of it. That leaves the sets incomplete until the next
// keyframe two seconds later, and everything held in between belongs to a
// keyframe whose sets were never seen: the consumer opens on data it cannot
// decode, which looks like a stream that never starts.
//
// Anything already held is therefore discarded whenever a new run begins.
type paramCollector struct {
	h265 bool
	spec *videoSpec
	held []*rtp.Packet
}

// startsRun reports whether a packet begins a parameter set run: the VPS for
// HEVC, the SPS for AVC.
func (c *paramCollector) startsRun(pkt *rtp.Packet) bool {
	if c.h265 {
		vps, _, _ := hevcParameterSets(pkt.Payload)
		return vps != nil
	}
	sps, _ := h264ParameterSets(pkt.Payload)
	return sps != nil
}

// offer takes the next packet from the stream and reports whether the parameter
// sets are now complete.
func (c *paramCollector) offer(pkt *rtp.Packet) bool {
	if c.startsRun(pkt) {
		c.held = c.held[:0]
		c.spec.vps, c.spec.sps, c.spec.pps = nil, nil, nil
	} else if len(c.held) == 0 {
		// Still waiting for a run to begin; nothing before it is usable.
		return false
	}

	c.held = append(c.held, pkt)

	if c.h265 {
		vps, sps, pps := hevcParameterSets(pkt.Payload)
		if vps != nil {
			c.spec.vps = vps
		}
		if sps != nil {
			c.spec.sps = sps
		}
		if pps != nil {
			c.spec.pps = pps
		}
		return c.spec.vps != nil && c.spec.sps != nil && c.spec.pps != nil
	}

	sps, pps := h264ParameterSets(pkt.Payload)
	if sps != nil {
		c.spec.sps = sps
	}
	if pps != nil {
		c.spec.pps = pps
	}
	return c.spec.sps != nil && c.spec.pps != nil
}

// complete reports whether every set the description needs has been seen.
func (c *paramCollector) complete() bool {
	if c.spec.sps == nil || c.spec.pps == nil {
		return false
	}
	return !c.h265 || c.spec.vps != nil
}
