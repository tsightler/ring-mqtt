package main

import (
	"io"
	"log"
	"testing"
	"time"
)

func TestReorderFromEnv(t *testing.T) {
	lg := log.New(io.Discard, "", 0)

	t.Setenv("RING_REORDER_WAIT", "250ms")
	t.Setenv("RING_REORDER_MAX", "1s")
	t.Setenv("RING_REORDER_DEPTH", "1024")
	wait, max, depth := reorderFromEnv(lg)
	if wait != 250*time.Millisecond || max != time.Second || depth != 1024 {
		t.Fatalf("got wait=%v max=%v depth=%d", wait, max, depth)
	}

	t.Setenv("RING_REORDER_WAIT", "soon")
	t.Setenv("RING_REORDER_MAX", "")
	t.Setenv("RING_REORDER_DEPTH", "-3")
	wait, max, depth = reorderFromEnv(lg)
	if wait != 0 || max != 0 || depth != 0 {
		t.Fatalf("invalid values should fall back to zero, got wait=%v max=%v depth=%d", wait, max, depth)
	}
}

func TestReorderEnvAppliesDefaults(t *testing.T) {
	lg := log.New(io.Discard, "", 0)
	t.Setenv("RING_REORDER_WAIT", "")
	t.Setenv("RING_REORDER_MAX", "")
	t.Setenv("RING_REORDER_DEPTH", "")
	c := sessionConfig{name: "test", ticket: "t", cameraID: 1, videoCodec: "h264", transport: "direct", publishURL: "rtsp://x", lg: lg}
	c.reorderWait, c.reorderMax, c.reorderDepth = reorderFromEnv(lg)
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	if c.reorderWait != defaultReorderWait || c.reorderMax != defaultReorderMax {
		t.Fatalf("unset env should keep the defaults, got wait=%v max=%v", c.reorderWait, c.reorderMax)
	}
}
