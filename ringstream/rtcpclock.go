package main

import (
	"log"
	"sync"
	"time"

	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
)

// ntpEpochOffset is the gap in seconds between the NTP epoch of 1900 and the
// Unix epoch of 1970.
const ntpEpochOffset = 2208988800

// ntpToTime converts the 64 bit timestamp carried in an RTCP sender report into
// wall clock time. The upper 32 bits count seconds since 1900 and the lower 32
// are a binary fraction of a second.
func ntpToTime(v uint64) time.Time {
	sec := int64(v>>32) - ntpEpochOffset
	frac := int64((v & 0xFFFFFFFF) * uint64(time.Second) >> 32)
	return time.Unix(sec, frac)
}

// ntpClock maps one track's RTP timestamps onto wall clock time using the
// sender reports Ring sends for it.
//
// RTP timestamps cannot be compared across tracks: video counts at 90 kHz and
// Opus at 48 kHz, and each stream begins from its own random offset. Nothing in
// the RTP header relates the two. The only thing that does is the pair of NTP
// and RTP times in a sender report, so a consumer that never receives one
// cannot align audio against video at all.
//
// Carrying Ring's mapping through matters more than having any mapping. The
// RTSP layer will happily invent one from the local clock, but that records
// when a packet reached us rather than when it was captured, and the two tracks
// do not arrive with the same delay. That difference is the skew.
type ntpClock struct {
	clockRate uint32

	mu    sync.Mutex
	have  bool
	ntp   time.Time
	rtpTS uint32
}

// observe records the mapping carried by a sender report.
func (c *ntpClock) observe(sr *rtcp.SenderReport) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.have, c.ntp, c.rtpTS = true, ntpToTime(sr.NTPTime), sr.RTPTime
}

// at returns the capture time of a packet carrying this RTP timestamp, falling
// back to now until Ring has sent a report. Extrapolating from the most recent
// report keeps every packet of both tracks on one timeline, which is what makes
// them comparable downstream.
func (c *ntpClock) at(rtpTS uint32) time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.have || c.clockRate == 0 {
		return time.Now()
	}
	// Signed, so timestamps preceding the report and 32 bit wraparound both
	// resolve to the right direction.
	delta := int32(rtpTS - c.rtpTS)
	return c.ntp.Add(time.Duration(int64(delta) * int64(time.Second) / int64(c.clockRate)))
}

// readSenderReports feeds a clock from a receiver's RTCP stream until it ends.
// Ring sends reports every few seconds, so the first one usually lands well
// before there is anything to synchronise.
func readSenderReports(lg *log.Logger, name string, recv *webrtc.RTPReceiver, c *ntpClock) {
	if recv == nil {
		return
	}
	seen := false
	for {
		pkts, _, err := recv.ReadRTCP()
		if err != nil {
			return
		}
		for _, p := range pkts {
			sr, ok := p.(*rtcp.SenderReport)
			if !ok {
				continue
			}
			c.observe(sr)
			if !seen {
				seen = true
				lg.Printf("%s: first sender report, rtp %d is %s",
					name, sr.RTPTime, ntpToTime(sr.NTPTime).UTC().Format("15:04:05.000"))
			}
		}
	}
}
