package main

import (
	"testing"
	"time"

	"github.com/pion/rtcp"
)

// A sender report at a known instant fixes the whole timeline for that track.
func TestNTPClockExtrapolatesFromSenderReport(t *testing.T) {
	base := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	c := &ntpClock{clockRate: 90000}
	c.observe(&rtcp.SenderReport{NTPTime: timeToNTP(base), RTPTime: 1000000})

	for _, tt := range []struct {
		name string
		rtp  uint32
		want time.Duration
	}{
		{"at the report", 1000000, 0},
		{"one second later", 1090000, time.Second},
		{"one second earlier", 910000, -time.Second},
		{"a frame later at 30fps", 1003000, time.Second / 30},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got := c.at(tt.rtp).Sub(base)
			if d := got - tt.want; d > time.Millisecond || d < -time.Millisecond {
				t.Fatalf("rtp %d mapped to %v, want %v", tt.rtp, got, tt.want)
			}
		})
	}
}

// The two tracks count at different rates from unrelated origins, so only the
// reports can align them. Video and audio captured at the same instant must
// come back out at the same instant.
func TestNTPClockAlignsTracksWithUnrelatedOrigins(t *testing.T) {
	base := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)

	video := &ntpClock{clockRate: 90000}
	video.observe(&rtcp.SenderReport{NTPTime: timeToNTP(base), RTPTime: 4000000})

	audio := &ntpClock{clockRate: 48000}
	audio.observe(&rtcp.SenderReport{NTPTime: timeToNTP(base), RTPTime: 77})

	// Two seconds on from the report in each track's own units.
	v := video.at(4000000 + 2*90000)
	a := audio.at(77 + 2*48000)
	if d := v.Sub(a); d > time.Millisecond || d < -time.Millisecond {
		t.Fatalf("tracks drifted by %v; they should land together", d)
	}
}

// Wraparound past 2^32 must extrapolate forwards, not jump back 13 hours.
func TestNTPClockHandlesTimestampWraparound(t *testing.T) {
	base := time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)
	c := &ntpClock{clockRate: 90000}
	c.observe(&rtcp.SenderReport{NTPTime: timeToNTP(base), RTPTime: 0xFFFFFFFF - 45000})

	got := c.at(44999) // 90000 ticks on, having wrapped
	if d := got.Sub(base) - time.Second; d > time.Millisecond || d < -time.Millisecond {
		t.Fatalf("wrapped timestamp mapped to %v after the report, want 1s", got.Sub(base))
	}
}

// Without a report there is nothing to extrapolate from, so it must not claim
// 1900 or some other fixed point.
func TestNTPClockFallsBackToNowBeforeAnyReport(t *testing.T) {
	c := &ntpClock{clockRate: 90000}
	if d := time.Since(c.at(12345)); d > time.Second || d < -time.Second {
		t.Fatalf("fallback returned %v away from now", d)
	}
}

func TestNTPToTimeRoundTrips(t *testing.T) {
	want := time.Date(2026, 8, 31, 12, 34, 56, 500000000, time.UTC)
	if got := ntpToTime(timeToNTP(want)); got.Sub(want) > time.Millisecond || want.Sub(got) > time.Millisecond {
		t.Fatalf("round trip gave %v, want %v", got.UTC(), want)
	}
}

// timeToNTP is the inverse of ntpToTime, for building reports in tests.
func timeToNTP(t time.Time) uint64 {
	sec := uint64(t.Unix() + ntpEpochOffset)
	frac := (uint64(t.Nanosecond()) << 32) / uint64(time.Second)
	return sec<<32 | frac
}
