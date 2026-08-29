package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

// The control socket replaces what used to be an MQTT round trip through an
// embedded broker and the mosquitto CLI. ring-mqtt holds the authenticated Ring
// session, so it stays the only thing that can mint a signaling ticket; this
// carries the request to it and the camera list back.
type controlMessage struct {
	Type string `json:"type"`
	ID   string `json:"id,omitempty"`
	Path string `json:"path,omitempty"`

	// cameras
	Cameras []cameraInfo `json:"cameras,omitempty"`

	// ticket response
	Ticket string `json:"ticket,omitempty"`

	// recording response, for playing back a recorded event
	RecordingURL string `json:"recordingUrl,omitempty"`
	Transcode    bool   `json:"transcode,omitempty"`
	Description  string `json:"description,omitempty"`

	// state report
	Status string `json:"status,omitempty"`

	Error string `json:"error,omitempty"`
}

// cameraInfo is what ring-mqtt knows about a camera that ringstream needs. It
// arrives over the socket rather than from a config file, so cameras that are
// discovered or reconfigured at runtime take effect without a restart.
type cameraInfo struct {
	Path       string `json:"path"`
	Name       string `json:"name"`
	CameraID   int    `json:"cameraId"`
	VideoCodec string `json:"videoCodec"`
}

type control struct {
	lg  *log.Logger
	url string

	// ticketWait bounds a ticket request. It is a round trip to ring-mqtt and
	// then to Ring's API, so it is not instant, but a stuck request must not
	// hold a DESCRIBE open indefinitely.
	ticketWait time.Duration

	writeMu sync.Mutex
	conn    *websocket.Conn

	mu      sync.Mutex
	cameras map[string]cameraInfo
	pending map[string]chan controlMessage

	// onStart and onStop carry explicit commands from ring-mqtt, which is how
	// the MQTT stream switch still turns a camera on with no RTSP client
	// attached.
	onStart func(path string)
	onStop  func(path string)
}

func newControl(lg *log.Logger, url string) *control {
	return &control{
		lg:         orDefault(lg),
		url:        url,
		ticketWait: 20 * time.Second,
		cameras:    map[string]cameraInfo{},
		pending:    map[string]chan controlMessage{},
	}
}

// run keeps a connection to ring-mqtt up until stop is closed. ringstream is
// started by ring-mqtt and supervised by it, so reconnecting here means a
// restart of either side heals without intervention.
func (c *control) run(stop <-chan struct{}) {
	backoff := time.Second
	for {
		select {
		case <-stop:
			return
		default:
		}

		if err := c.connect(stop); err != nil {
			c.lg.Printf("control: %v, retrying in %s", err, backoff)
			select {
			case <-stop:
				return
			case <-time.After(backoff):
			}
			if backoff < 15*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
	}
}

func (c *control) connect(stop <-chan struct{}) error {
	conn, _, err := websocket.DefaultDialer.Dial(c.url, nil)
	if err != nil {
		return err
	}
	c.lg.Printf("control: connected to %s", c.url)

	c.writeMu.Lock()
	c.conn = conn
	c.writeMu.Unlock()

	defer func() {
		c.writeMu.Lock()
		if c.conn == conn {
			c.conn = nil
		}
		c.writeMu.Unlock()
		_ = conn.Close()
		c.failPending("control connection lost")
	}()

	_ = c.send(controlMessage{Type: "hello"})

	for {
		var m controlMessage
		if err := conn.ReadJSON(&m); err != nil {
			select {
			case <-stop:
				return nil
			default:
			}
			return fmt.Errorf("read: %w", err)
		}
		c.handle(m)
	}
}

func (c *control) send(m controlMessage) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.conn == nil {
		return fmt.Errorf("control connection is down")
	}
	return c.conn.WriteJSON(m)
}

func (c *control) handle(m controlMessage) {
	switch m.Type {
	case "cameras":
		next := make(map[string]cameraInfo, len(m.Cameras))
		for _, cam := range m.Cameras {
			next[cam.Path] = cam
		}
		c.mu.Lock()
		c.cameras = next
		c.mu.Unlock()
		c.lg.Printf("control: %d cameras registered", len(next))

	case "ticket", "recording":
		c.mu.Lock()
		waiter := c.pending[m.ID]
		delete(c.pending, m.ID)
		c.mu.Unlock()
		if waiter != nil {
			waiter <- m
		}

	case "start":
		if c.onStart != nil {
			c.onStart(m.Path)
		}

	case "stop":
		if c.onStop != nil {
			c.onStop(m.Path)
		}

	default:
		c.lg.Printf("control: ignoring unknown message %q", m.Type)
	}
}

// failPending releases every in flight request when the socket drops, so a
// DESCRIBE waiting on a ticket fails promptly instead of timing out.
func (c *control) failPending(reason string) {
	c.mu.Lock()
	waiters := c.pending
	c.pending = map[string]chan controlMessage{}
	c.mu.Unlock()
	for id, ch := range waiters {
		ch <- controlMessage{Type: "ticket", ID: id, Error: reason}
	}
}

func (c *control) camera(path string) (cameraInfo, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	cam, ok := c.cameras[path]
	return cam, ok
}

// request sends a message and waits for the reply carrying the same id.
func (c *control) request(kind, path string) (controlMessage, error) {
	id := uuid.NewString()
	// Buffered so failPending never blocks on a waiter that has already given
	// up and gone away.
	reply := make(chan controlMessage, 1)

	c.mu.Lock()
	c.pending[id] = reply
	c.mu.Unlock()

	if err := c.send(controlMessage{Type: kind, ID: id, Path: path}); err != nil {
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return controlMessage{}, err
	}

	select {
	case m := <-reply:
		if m.Error != "" {
			return controlMessage{}, fmt.Errorf("%s", m.Error)
		}
		return m, nil
	case <-time.After(c.ticketWait):
		c.mu.Lock()
		delete(c.pending, id)
		c.mu.Unlock()
		return controlMessage{}, fmt.Errorf("timed out waiting for a reply about %s", path)
	}
}

func (c *control) requestTicket(path string) (string, error) {
	m, err := c.request("ticket_request", path)
	if err != nil {
		return "", fmt.Errorf("ticket for %s: %w", path, err)
	}
	if m.Ticket == "" {
		return "", fmt.Errorf("ticket for %s was empty", path)
	}
	return m.Ticket, nil
}

// activateEvent resolves the recording behind an event path. Only ring-mqtt can
// do that, the same as for a signaling ticket.
func (c *control) activateEvent(ffmpegPath string) activateEventFunc {
	return func(path string) (eventInfo, error) {
		cam, ok := c.camera(path)
		if !ok {
			return eventInfo{}, fmt.Errorf("no camera registered for %q", path)
		}

		c.reportState(path, "activating")

		m, err := c.request("recording_request", path)
		if err != nil {
			c.reportState(path, "failed")
			return eventInfo{}, err
		}
		if m.RecordingURL == "" {
			c.reportState(path, "failed")
			return eventInfo{}, fmt.Errorf("no recording available for %s", path)
		}

		return eventInfo{
			name:         cam.Name,
			recordingURL: m.RecordingURL,
			transcode:    m.Transcode,
			description:  m.Description,
			ffmpegPath:   ffmpegPath,
			state:        func(st string) { c.reportState(path, st) },
		}, nil
	}
}

func (c *control) reportState(path, status string) {
	if err := c.send(controlMessage{Type: "state", Path: path, Status: status}); err != nil {
		c.lg.Printf("control: could not report %s for %s: %v", status, path, err)
	}
}

// activate builds the session for a stream the RTSP server has been asked for.
func (c *control) activate(ffmpegPath string) activateFunc {
	return func(path string) (sessionConfig, error) {
		cam, ok := c.camera(path)
		if !ok {
			return sessionConfig{}, fmt.Errorf("no camera registered for %q", path)
		}

		c.reportState(path, "activating")

		ticket, err := c.requestTicket(path)
		if err != nil {
			c.reportState(path, "failed")
			return sessionConfig{}, err
		}

		codec := cam.VideoCodec
		if codec == "" {
			codec = "h264"
		}

		return sessionConfig{
			name:       cam.Name,
			cameraID:   cam.CameraID,
			ticket:     ticket,
			videoCodec: codec,
			transport:  "direct",
			ffmpegPath: ffmpegPath,
			trackWait:  5 * time.Second,
			state:      func(s string) { c.reportState(path, s) },
		}, nil
	}
}
