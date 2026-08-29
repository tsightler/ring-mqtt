package main

import (
	"testing"
	"time"
)

// The daemon builds its own sessionConfig and never sees a flag, so anything
// that defaults only on the flag is off in production. validate is the one
// place every path goes through.
func TestValidateAppliesReorderDefaults(t *testing.T) {
	c := &sessionConfig{name: "cam", videoCodec: "h265", transport: "direct", ticket: "t", cameraID: 1, publishURL: "rtsp://127.0.0.1:8554/x"}
	if err := c.validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if c.reorderWait != defaultReorderWait {
		t.Fatalf("reorderWait=%v, want the default %v", c.reorderWait, defaultReorderWait)
	}
	if c.reorderDepth != defaultReorderDepth {
		t.Fatalf("reorderDepth=%d, want the default %d", c.reorderDepth, defaultReorderDepth)
	}
}

func TestValidateKeepsAnExplicitReorderWait(t *testing.T) {
	c := &sessionConfig{name: "cam", videoCodec: "h265", transport: "direct", ticket: "t", cameraID: 1, publishURL: "rtsp://127.0.0.1:8554/x", reorderWait: 250 * time.Millisecond}
	if err := c.validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if c.reorderWait != 250*time.Millisecond {
		t.Fatalf("reorderWait=%v, want it left alone", c.reorderWait)
	}
}

// Negative is the only way to ask for straight through forwarding, since zero
// now means "unset".
func TestValidateNegativeDisablesReordering(t *testing.T) {
	c := &sessionConfig{name: "cam", videoCodec: "h265", transport: "direct", ticket: "t", cameraID: 1, publishURL: "rtsp://127.0.0.1:8554/x", reorderWait: -1}
	if err := c.validate(); err != nil {
		t.Fatalf("validate: %v", err)
	}
	if c.reorderWait != 0 {
		t.Fatalf("reorderWait=%v, want 0 (disabled)", c.reorderWait)
	}
}
