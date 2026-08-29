package main

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/pion/rtp"
)

// publisher sends RTP to ffmpeg over RTSP interleaved on TCP. Unlike the UDP
// path there is no receive buffer to overrun: a slow reader applies back
// pressure rather than silently dropping packets out of the middle of a
// keyframe. Sender reports carry the NTP mapping taken from Ring's own reports
// rather than the local clock, which is what lets a consumer line audio up
// against video.
type publisher struct {
	lg *log.Logger

	client *gortsplib.Client
	video  *description.Media
	audio  *description.Media

	mu      sync.Mutex
	stopped bool
	rs      videoResync
}

type videoSpec struct {
	payloadType uint8
	h265        bool
	vps         []byte
	sps         []byte
	pps         []byte
}

type audioSpec struct {
	payloadType uint8
	channels    int
	isOpus      bool
}

func newPublisher(lg *log.Logger, url string, v *videoSpec, a *audioSpec) (*publisher, error) {
	p := &publisher{lg: orDefault(lg)}
	p.rs.lg = p.lg
	if v != nil {
		p.rs.h265 = v.h265
	}
	video, audio, err := buildMedias(v, a)
	if err != nil {
		return nil, err
	}
	p.video, p.audio = video, audio
	medias := mediaList(video, audio)

	proto := gortsplib.ProtocolTCP
	p.client = &gortsplib.Client{Protocol: &proto}

	if err := p.client.StartRecording(url, &description.Session{Medias: medias}); err != nil {
		return nil, fmt.Errorf("start recording: %w", err)
	}
	return p, nil
}

// newPublisherWithRetry waits for ffmpeg's RTSP listener to accept connections.
func newPublisherWithRetry(lg *log.Logger, url string, v *videoSpec, a *audioSpec, timeout time.Duration) (*publisher, error) {
	deadline := time.Now().Add(timeout)
	var last error
	for time.Now().Before(deadline) {
		p, err := newPublisher(lg, url, v, a)
		if err == nil {
			return p, nil
		}
		last = err
		time.Sleep(100 * time.Millisecond)
	}
	return nil, last
}

// waitReady returns at once: StartRecording has already established the
// connection, so anything written now reaches the far end.
func (p *publisher) waitReady(time.Duration) {}

func (p *publisher) writeVideo(pkt *rtp.Packet, ntp time.Time) error {
	return p.write(p.video, pkt, ntp)
}

func (p *publisher) writeAudio(pkt *rtp.Packet, ntp time.Time) error {
	return p.write(p.audio, pkt, ntp)
}

func (p *publisher) write(m *description.Media, pkt *rtp.Packet, ntp time.Time) error {
	if m == nil {
		return nil
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stopped {
		return nil
	}

	if m == p.video {
		if pkt = p.rs.filter(pkt); pkt == nil {
			return nil
		}
	}

	if err := p.client.WritePacketRTPWithNTP(m, sanitize(pkt), ntp); err != nil {
		p.lg.Printf("rtsp write: %v", err)
		return err
	}
	return nil
}

func (p *publisher) close() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stopped {
		return
	}
	p.stopped = true
	p.client.Close()
}
