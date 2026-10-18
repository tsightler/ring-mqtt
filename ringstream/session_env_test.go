package main

import "testing"

// RTSP credentials can be handed over in the environment so they never appear
// in the process list, while the flags keep working for existing launchers.
func TestEnvOverridePrefersTheEnvironment(t *testing.T) {
	t.Setenv("RING_RTSP_PASS", "from-env")
	if got := envOverride("RING_RTSP_PASS", "from-flag"); got != "from-env" {
		t.Fatalf("got %q, want the environment value", got)
	}
}

func TestEnvOverrideFallsBackToTheFlag(t *testing.T) {
	t.Setenv("RING_RTSP_PASS", "")
	if got := envOverride("RING_RTSP_PASS", "from-flag"); got != "from-flag" {
		t.Fatalf("got %q, want the flag value", got)
	}
	if got := envOverride("RING_RTSP_PASS", ""); got != "" {
		t.Fatalf("got %q, want empty so authentication stays disabled", got)
	}
}
