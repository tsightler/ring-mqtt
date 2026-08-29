package main

import (
	"bytes"
	"log"
	"strings"
	"sync"
	"testing"
	"time"
)

// A panic in a goroutine cannot be recovered by whoever started it, so a
// deferred recover around the `go` statement catches nothing and the process
// dies. This test surviving at all is the assertion: without the recover inside
// the goroutine, it would take the whole test binary down.
func TestGoSafeContainsPanicAndReportsIt(t *testing.T) {
	var buf bytes.Buffer
	var mu sync.Mutex
	lg := log.New(&writerFunc{&mu, &buf}, "", 0)

	done := make(chan struct{})
	goSafe(lg, "exploding worker", func() {
		panic("boom")
	}, func() { close(done) })

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("onPanic was never called, so the session would hang behind a dead goroutine")
	}

	mu.Lock()
	out := buf.String()
	mu.Unlock()

	if !strings.Contains(out, "panic in exploding worker") {
		t.Fatalf("panic was not reported: %q", out)
	}
	if !strings.Contains(out, "boom") {
		t.Fatalf("panic value missing from the report: %q", out)
	}
}

// The normal path must not be disturbed by the wrapper.
func TestGoSafeRunsNormallyWithoutPanicking(t *testing.T) {
	ran := make(chan struct{})
	panicked := false
	goSafe(nil, "worker", func() { close(ran) }, func() { panicked = true })

	select {
	case <-ran:
	case <-time.After(3 * time.Second):
		t.Fatal("fn never ran")
	}
	time.Sleep(50 * time.Millisecond)
	if panicked {
		t.Fatal("onPanic fired for a clean run")
	}
}

// A nil logger must not itself become the crash. This is what took the daemon
// down: a constructor accepted a logger, never stored it, and the first log
// line dereferenced nil.
func TestGoSafeToleratesNilLogger(t *testing.T) {
	done := make(chan struct{})
	goSafe(nil, "worker", func() { panic("boom") }, func() { close(done) })

	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("a nil logger stopped the panic from being contained")
	}
}

type writerFunc struct {
	mu  *sync.Mutex
	buf *bytes.Buffer
}

func (w *writerFunc) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.Write(p)
}

// dialUDP accepted a logger and dropped it, which is the bug that killed the
// daemon in signaling. Constructors that take a logger must store one.
func TestDialUDPStoresItsLogger(t *testing.T) {
	track, err := dialUDP(nil, "video", 9999)
	if err != nil {
		t.Fatalf("dialUDP: %v", err)
	}
	defer track.close()

	if track.lg == nil {
		t.Fatal("logger is nil; the first log line from this track would panic")
	}
}
