package main

import (
	"log"
	"os"
)

// A daemon runs many streams at once and their output interleaves, so a log
// line without a camera on it is close to useless. Each session carries its own
// logger with the camera as a prefix; everything that logs takes one rather
// than reaching for the package level logger.
func newSessionLogger(name string) *log.Logger {
	prefix := ""
	if name != "" {
		prefix = "[" + name + "] "
	}
	return log.New(os.Stderr, prefix, log.Ltime|log.Lmicroseconds)
}

// defaultLogger matches what the process wide logger produced before sessions
// had their own, so the one shot path's output is unchanged.
var defaultLogger = newSessionLogger("")

// orDefault keeps a missing logger from being a nil dereference in code paths
// that are constructed outside a session.
func orDefault(lg *log.Logger) *log.Logger {
	if lg == nil {
		return defaultLogger
	}
	return lg
}
