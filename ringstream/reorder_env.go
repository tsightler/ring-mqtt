package main

import (
	"log"
	"os"
	"strconv"
	"time"
)

// reorderFromEnv lets daemon sessions take the reorder buffer settings that
// single sessions take from -reorder-wait, -reorder-max and -reorder-depth.
// ring-mqtt passes its own environment to the helper, so these can be set on
// the container. Unset or invalid values return zero, which sessionConfig
// replaces with the defaults.
//
//	RING_REORDER_WAIT   shortest hold for a video gap, e.g. 250ms
//	RING_REORDER_MAX    longest hold for a video gap, e.g. 1s
//	RING_REORDER_DEPTH  packets that may be held while waiting on a gap
func reorderFromEnv(lg *log.Logger) (wait, maxWait time.Duration, depth int) {
	wait = envDuration(lg, "RING_REORDER_WAIT")
	maxWait = envDuration(lg, "RING_REORDER_MAX")
	if v := os.Getenv("RING_REORDER_DEPTH"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			lg.Printf("ignoring RING_REORDER_DEPTH=%q: not a positive integer", v)
		} else {
			depth = n
		}
	}
	return wait, maxWait, depth
}

func envDuration(lg *log.Logger, name string) time.Duration {
	v := os.Getenv(name)
	if v == "" {
		return 0
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		lg.Printf("ignoring %s=%q: %v", name, v, err)
		return 0
	}
	return d
}
