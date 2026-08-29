package main

import (
	"bytes"
	"fmt"
	"log"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// describe opens a raw RTSP connection and sends a DESCRIBE, returning the
// status line. Raw TCP keeps the test honest about what an arbitrary client on
// the network can do without credentials.
func describe(t *testing.T, addr, path string) string {
	t.Helper()
	conn, err := net.DialTimeout("tcp", addr, 3*time.Second)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	req := fmt.Sprintf("DESCRIBE rtsp://%s/%s RTSP/1.0\r\nCSeq: 1\r\n\r\n", addr, path)
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write: %v", err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(3 * time.Second))
	buf := make([]byte, 256)
	n, err := conn.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	return strings.SplitN(string(buf[:n]), "\r\n", 2)[0]
}

func startTestServer(t *testing.T, addr, user, pass string, activated *atomic.Int32) *streamServer {
	t.Helper()
	s := newStreamServer(log.New(&bytes.Buffer{}, "", 0), addr, user, pass,
		func(path string) (sessionConfig, error) {
			activated.Add(1)
			return sessionConfig{}, fmt.Errorf("no ring in tests")
		})
	s.describeWait = 2 * time.Second
	if err := s.start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	t.Cleanup(s.close)
	return s
}

// Credentials gate the request before the camera is touched. Activating first
// would let anyone who can reach the port open a Ring session, burning battery
// and bandwidth on a caller that is then refused.
func TestUnauthenticatedRequestNeverStartsACamera(t *testing.T) {
	var activated atomic.Int32
	addr := "127.0.0.1:18997"
	startTestServer(t, addr, "user", "secret", &activated)

	if status := describe(t, addr, "cam_live"); !strings.Contains(status, "401") {
		t.Fatalf("status = %q, want 401", status)
	}
	if n := activated.Load(); n != 0 {
		t.Fatalf("activate was called %d times for an unauthenticated request", n)
	}
}

// With no credentials configured the server is open, which is the default and
// what the addon warns about exposing. This also proves the check above is what
// blocked activation, rather than something else failing first.
func TestOpenServerActivatesOnDescribe(t *testing.T) {
	var activated atomic.Int32
	addr := "127.0.0.1:18996"
	startTestServer(t, addr, "", "", &activated)

	if status := describe(t, addr, "cam_live"); !strings.Contains(status, "404") {
		t.Fatalf("status = %q, want 404 from a failed activation", status)
	}
	if n := activated.Load(); n != 1 {
		t.Fatalf("activate called %d times, want 1", n)
	}
}
