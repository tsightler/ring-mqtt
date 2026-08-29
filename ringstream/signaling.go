package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const signalingHost = "wss://api.prod.signalling.ring.devices.a2z.com:443/ws"

// message is the envelope used by Ring's signaling websocket.
type message struct {
	Method   string          `json:"method"`
	DialogID string          `json:"dialog_id,omitempty"`
	Body     json.RawMessage `json:"body,omitempty"`
	Reason   *closeReason    `json:"reason,omitempty"`
}

type closeReason struct {
	Code int    `json:"code"`
	Text string `json:"text"`
}

// body covers every field we care about across the message types Ring sends.
type body struct {
	DoorbotID  int    `json:"doorbot_id"`
	SessionID  string `json:"session_id"`
	SDP        string `json:"sdp"`
	Ice        string `json:"ice"`
	MLineIndex uint16 `json:"mlineindex"`
	Text       string `json:"text"`
}

type signaling struct {
	lg *log.Logger

	conn     *websocket.Conn
	cameraID int
	dialogID string

	writeMu   sync.Mutex
	sessionMu sync.Mutex
	sessionID string

	onAnswer    func(sdp string)
	onCandidate func(candidate string, mline uint16)
	onClose     func()

	closeMu sync.Mutex
	closed  bool
	done    chan struct{}
}

func newSignaling(lg *log.Logger, ticket string, cameraID int) (*signaling, error) {
	url := fmt.Sprintf("%s?api_version=4.0&auth_type=ring_solutions&client_id=ring_site-%s&token=%s",
		signalingHost, uuid.NewString(), ticket)

	// Ring closes the socket immediately without a User-Agent; the value is not checked.
	hdr := http.Header{}
	hdr.Set("User-Agent", "android:com.ringapp")

	conn, _, err := websocket.DefaultDialer.Dial(url, hdr)
	if err != nil {
		return nil, fmt.Errorf("signaling dial: %w", err)
	}

	return &signaling{
		lg:       orDefault(lg),
		conn:     conn,
		cameraID: cameraID,
		dialogID: uuid.NewString(),
		done:     make(chan struct{}),
	}, nil
}

func (s *signaling) send(m message) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return s.conn.WriteJSON(m)
}

func (s *signaling) sendBody(method string, b map[string]any) error {
	b["doorbot_id"] = s.cameraID
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return s.send(message{Method: method, DialogID: s.dialogID, Body: raw})
}

// sendSession adds the session id, which Ring requires on ping/activate/stream_options.
func (s *signaling) sendSession(method string, extra map[string]any) error {
	s.sessionMu.Lock()
	id := s.sessionID
	s.sessionMu.Unlock()
	if id == "" {
		return nil // no session yet, nothing to keep alive
	}
	b := map[string]any{"session_id": id}
	for k, v := range extra {
		b[k] = v
	}
	return s.sendBody(method, b)
}

func (s *signaling) sendOffer(sdp string) error {
	return s.sendBody("live_view", map[string]any{
		"stream_options": map[string]bool{"audio_enabled": true, "video_enabled": true},
		"sdp":            sdp,
	})
}

func (s *signaling) sendCandidate(candidate string, mline uint16) error {
	return s.sendBody("ice", map[string]any{
		"ice":        candidate,
		"mlineindex": mline,
	})
}

// activate keeps the stream alive past the 70 second default.
func (s *signaling) activate() {
	if err := s.sendSession("activate_session", nil); err != nil {
		s.lg.Printf("activate_session: %v", err)
	}
	if err := s.sendSession("stream_options", map[string]any{
		"audio_enabled": true, "video_enabled": true,
	}); err != nil {
		s.lg.Printf("stream_options: %v", err)
	}
}

func (s *signaling) keepalive() {
	t := time.NewTicker(5 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.done:
			return
		case <-t.C:
			if err := s.sendSession("ping", nil); err != nil {
				s.lg.Printf("ping: %v", err)
			}
		}
	}
}

func (s *signaling) readLoop() {
	defer s.shutdown()
	for {
		var m message
		if err := s.conn.ReadJSON(&m); err != nil {
			s.lg.Printf("signaling read: %v", err)
			return
		}

		var b body
		if len(m.Body) > 0 {
			if err := json.Unmarshal(m.Body, &b); err != nil {
				s.lg.Printf("signaling body decode (%s): %v", m.Method, err)
				continue
			}
		}

		if b.DoorbotID != 0 && b.DoorbotID != s.cameraID {
			continue // message for a different camera
		}

		if (m.Method == "session_created" || m.Method == "session_started") && b.SessionID != "" {
			s.sessionMu.Lock()
			if s.sessionID == "" {
				s.sessionID = b.SessionID
			}
			s.sessionMu.Unlock()
			continue
		}

		s.sessionMu.Lock()
		known := s.sessionID
		s.sessionMu.Unlock()
		if b.SessionID != "" && known != "" && b.SessionID != known {
			continue // message for a different session
		}

		switch m.Method {
		case "pong", "stream_info", "timed_metadata":
			// not used
		case "sdp":
			s.lg.Printf("received answer from Ring")
			if s.onAnswer != nil {
				s.onAnswer(b.SDP)
			}
			s.activate()
		case "ice":
			if s.onCandidate != nil && b.Ice != "" {
				s.onCandidate(b.Ice, b.MLineIndex)
			}
		case "camera_started":
			s.lg.Printf("Ring reports the camera has started streaming")
		case "notification":
			if b.Text != "" {
				s.lg.Printf("notification: %s", b.Text)
			}
		case "close":
			s.lg.Printf("Ring closed the session")
			return
		default:
			s.lg.Printf("unhandled signaling method: %s", m.Method)
		}
	}
}

// shutdown is safe to call more than once and safe to re-enter: onClose calls
// back into the caller's own shutdown, which calls this again.
func (s *signaling) shutdown() {
	s.closeMu.Lock()
	if s.closed {
		s.closeMu.Unlock()
		return
	}
	s.closed = true
	s.closeMu.Unlock()

	close(s.done)
	_ = s.send(message{Method: "close", Reason: &closeReason{Code: 0, Text: ""}})
	_ = s.conn.Close()
	if s.onClose != nil {
		s.onClose()
	}
}
