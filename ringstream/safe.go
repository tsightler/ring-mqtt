package main

import (
	"log"
	"runtime/debug"
)

// goSafe runs fn in a goroutine that cannot take the process down with it.
//
// recover only works in the goroutine that panicked, so a deferred recover
// where a goroutine is started catches nothing: the panic unwinds that
// goroutine's own stack and then kills the process. Every long lived goroutine
// a session starts therefore needs its own, or one camera's failure ends every
// other camera's stream too.
//
// onPanic, when supplied, tears the session down so it fails cleanly rather
// than hanging with a dead goroutine behind it.
func goSafe(lg *log.Logger, what string, fn func(), onPanic func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				orDefault(lg).Printf("panic in %s: %v\n%s", what, r, debug.Stack())
				if onPanic != nil {
					onPanic()
				}
			}
		}()
		fn()
	}()
}
