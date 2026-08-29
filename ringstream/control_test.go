package main

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// controlHarness stands up the ring-mqtt side of the socket so the protocol is
// exercised for real rather than by calling the handlers directly.
type controlHarness struct {
	ctl    *control
	server *httptest.Server
	conn   chan *websocket.Conn
	stop   chan struct{}
}

func newHarness(t *testing.T) *controlHarness {
	t.Helper()
	h := &controlHarness{
		conn: make(chan *websocket.Conn, 1),
		stop: make(chan struct{}),
	}

	up := websocket.Upgrader{}
	h.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := up.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		var hello controlMessage
		if err := c.ReadJSON(&hello); err != nil || hello.Type != "hello" {
			t.Errorf("expected hello, got %+v (%v)", hello, err)
		}
		h.conn <- c
		<-h.stop
	}))

	h.ctl = newControl(log.New(&bytes.Buffer{}, "", 0), "ws"+strings.TrimPrefix(h.server.URL, "http"))
	h.ctl.ticketWait = 2 * time.Second
	go h.ctl.run(h.stop)

	t.Cleanup(func() {
		close(h.stop)
		h.server.Close()
	})
	return h
}

// waitForCamera blocks until the registration has been applied.
func (h *controlHarness) waitForCamera(t *testing.T, path string) {
	t.Helper()
	for i := 0; i < 100; i++ {
		if _, ok := h.ctl.camera(path); ok {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("camera %q never registered", path)
}

func TestControlActivatesFromRegisteredCamera(t *testing.T) {
	h := newHarness(t)
	conn := <-h.conn

	if err := conn.WriteJSON(controlMessage{
		Type: "cameras",
		Cameras: []cameraInfo{{
			Path: "cam_live", Name: "Front Porch", CameraID: 42, VideoCodec: "h265",
		}},
	}); err != nil {
		t.Fatal(err)
	}
	h.waitForCamera(t, "cam_live")

	type result struct {
		cfg sessionConfig
		err error
	}
	done := make(chan result, 1)
	go func() {
		cfg, err := h.ctl.activate("")("cam_live")
		done <- result{cfg, err}
	}()

	// The activation should report activating, then ask for a ticket.
	var req controlMessage
	for {
		if err := conn.ReadJSON(&req); err != nil {
			t.Fatal(err)
		}
		if req.Type == "ticket_request" {
			break
		}
		if req.Type != "state" {
			t.Fatalf("unexpected message %+v", req)
		}
	}
	if req.Path != "cam_live" || req.ID == "" {
		t.Fatalf("bad ticket request: %+v", req)
	}

	if err := conn.WriteJSON(controlMessage{Type: "ticket", ID: req.ID, Ticket: "tkt-123"}); err != nil {
		t.Fatal(err)
	}

	got := <-done
	if got.err != nil {
		t.Fatalf("activate: %v", got.err)
	}
	if got.cfg.ticket != "tkt-123" {
		t.Errorf("ticket = %q", got.cfg.ticket)
	}
	if got.cfg.cameraID != 42 || got.cfg.name != "Front Porch" || got.cfg.videoCodec != "h265" {
		t.Errorf("config not taken from the registration: %+v", got.cfg)
	}
}

func TestControlRejectsUnknownCameraWithoutAskingForATicket(t *testing.T) {
	h := newHarness(t)
	<-h.conn

	if _, err := h.ctl.activate("")("nope_live"); err == nil {
		t.Fatal("expected an error for an unregistered camera")
	}
}

// A ticket failure has to surface, not hang the DESCRIBE that is waiting on it.
func TestControlPropagatesTicketFailure(t *testing.T) {
	h := newHarness(t)
	conn := <-h.conn

	if err := conn.WriteJSON(controlMessage{
		Type:    "cameras",
		Cameras: []cameraInfo{{Path: "cam_live", Name: "Cam", CameraID: 7}},
	}); err != nil {
		t.Fatal(err)
	}
	h.waitForCamera(t, "cam_live")

	errc := make(chan error, 1)
	go func() {
		_, err := h.ctl.activate("")("cam_live")
		errc <- err
	}()

	var req controlMessage
	for {
		if err := conn.ReadJSON(&req); err != nil {
			t.Fatal(err)
		}
		if req.Type == "ticket_request" {
			break
		}
	}
	if err := conn.WriteJSON(controlMessage{
		Type: "ticket", ID: req.ID, Error: "live streaming blocked by Modes",
	}); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-errc:
		if err == nil || !strings.Contains(err.Error(), "Modes") {
			t.Fatalf("error did not carry the reason: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("activate hung instead of failing")
	}
}

// An unset codec must not reach the session as an empty string.
func TestControlDefaultsMissingCodec(t *testing.T) {
	h := newHarness(t)
	conn := <-h.conn

	if err := conn.WriteJSON(controlMessage{
		Type:    "cameras",
		Cameras: []cameraInfo{{Path: "cam_live", Name: "Cam", CameraID: 7}},
	}); err != nil {
		t.Fatal(err)
	}
	h.waitForCamera(t, "cam_live")

	done := make(chan sessionConfig, 1)
	go func() {
		cfg, _ := h.ctl.activate("")("cam_live")
		done <- cfg
	}()

	var req controlMessage
	for {
		if err := conn.ReadJSON(&req); err != nil {
			t.Fatal(err)
		}
		if req.Type == "ticket_request" {
			break
		}
	}
	if err := conn.WriteJSON(controlMessage{Type: "ticket", ID: req.ID, Ticket: "t"}); err != nil {
		t.Fatal(err)
	}

	if cfg := <-done; cfg.videoCodec != "h264" {
		t.Fatalf("codec = %q, want the h264 default", cfg.videoCodec)
	}
}
