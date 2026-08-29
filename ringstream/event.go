package main

import (
	"bufio"
	"fmt"
	"net"
	"os/exec"
	"strings"
	"time"

	"github.com/bluenviron/gortsplib/v5"
	"github.com/bluenviron/gortsplib/v5/pkg/base"
	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
	"github.com/bluenviron/gortsplib/v5/pkg/liberrors"
	"github.com/pion/rtp"
)

// eventInfo describes a recorded event to play back. Only ring-mqtt can resolve
// a recording URL, so this arrives over the control socket the same way a
// signaling ticket does.
type eventInfo struct {
	name         string
	recordingURL string

	// transcode is set when the recording is HEVC or was transcoded for
	// download. Ring's downloadable transcodes carry very few keyframes, which
	// leaves a reader staring at nothing until the next one, so they are
	// re-encoded on the fly with a short GOP.
	transcode  bool
	ffmpegPath string

	// description is what the event selector resolved to, for the log.
	description string

	state func(string)
}

type activateEventFunc func(path string) (eventInfo, error)

// runEvent plays a recording into the server by having ffmpeg publish it, so a
// reader consumes an event exactly as it consumes a live camera.
func (s *streamServer) runEvent(ss *servedStream) {
	info, err := s.activateEvent(ss.path)
	if err != nil {
		ss.finish(err)
		return
	}
	if info.ffmpegPath == "" {
		ss.finish(fmt.Errorf("no ffmpeg available to play back %s", ss.path))
		return
	}

	ss.mu.Lock()
	ss.lg = newSessionLogger(info.name)
	lg := ss.lg
	ss.mu.Unlock()

	publishURL := s.loopbackURL(ss.path)

	// Without these ffmpeg's progress counter arrives as a line per update and
	// buries anything worth reading.
	args := []string{
		"-hide_banner", "-loglevel", "warning", "-nostats",
		"-re", "-i", info.recordingURL,
		"-map", "0:v", "-map", "0:a", "-map", "0:a",
	}
	if info.transcode {
		args = append(args,
			"-c:v", "libx264",
			"-g", "20",
			"-keyint_min", "10",
			"-crf", "23",
			"-preset", "ultrafast")
	} else {
		args = append(args, "-c:v", "copy")
	}
	args = append(args,
		"-c:a:0", "copy",
		"-c:a:1", "libopus",
		"-flags", "+global_header",
		"-rtsp_transport", "tcp",
		"-f", "rtsp",
		publishURL)

	cmd := exec.Command(info.ffmpegPath, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		ss.finish(fmt.Errorf("ffmpeg stderr for %s: %w", ss.path, err))
		return
	}
	if err := cmd.Start(); err != nil {
		ss.finish(fmt.Errorf("start ffmpeg for %s: %w", ss.path, err))
		return
	}

	// ffmpeg's output was previously discarded, so a recording that failed to
	// play gave no clue why.
	goSafe(lg, "event ffmpeg output", func() {
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		sc.Split(scanLinesCR)
		for sc.Scan() {
			if line := strings.TrimSpace(sc.Text()); line != "" {
				lg.Printf("ffmpeg: %s", line)
			}
		}
	}, nil)

	what := info.description
	if what == "" {
		what = "a recorded event"
	}
	if info.transcode {
		lg.Printf("playing back %s, re-encoding to H.264", what)
	} else {
		lg.Printf("playing back %s", what)
	}
	started := time.Now()

	// ffmpeg exiting is the end of the recording, which is a normal finish
	// rather than a failure.
	exited := make(chan error, 1)
	goSafe(lg, "event playback wait", func() { exited <- cmd.Wait() }, nil)

	defer func() {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-exited
		if info.state != nil {
			info.state("inactive")
		}
	}()

	select {
	case <-ss.done:
		// ffmpeg announced its tracks and readers can be served.
		if info.state != nil {
			info.state("active")
		}
	case err := <-exited:
		exited <- err
		ss.finish(fmt.Errorf("ffmpeg ended before publishing %s: %v", ss.path, err))
		if info.state != nil {
			info.state("failed")
		}
		return
	case <-time.After(s.describeWait):
		ss.finish(fmt.Errorf("ffmpeg did not publish %s in time", ss.path))
		if info.state != nil {
			info.state("failed")
		}
		return
	}

	select {
	case <-ss.stop:
		lg.Printf("event playback stopped after %s", time.Since(started).Round(time.Second))
	case err := <-exited:
		exited <- err
		if err != nil {
			lg.Printf("event playback ended after %s: %v", time.Since(started).Round(time.Second), err)
		} else {
			lg.Printf("recorded event finished after %s", time.Since(started).Round(time.Second))
		}
	}
}

// loopbackURL is where ffmpeg publishes. The server may listen on every
// interface, so the host is pinned to loopback rather than taken from the
// listen address.
func (s *streamServer) loopbackURL(path string) string {
	_, port, err := net.SplitHostPort(s.srv.RTSPAddress)
	if err != nil || port == "" {
		port = "8554"
	}
	auth := ""
	if s.user != "" || s.pass != "" {
		auth = s.user + ":" + s.pass + "@"
	}
	return fmt.Sprintf("rtsp://%s127.0.0.1:%s/%s", auth, port, path)
}

func isEventPath(path string) bool {
	return strings.HasSuffix(path, "_event")
}

// --- publisher side of the server -------------------------------------------

// OnAnnounce accepts the tracks ffmpeg is about to publish for an event.
func (s *streamServer) OnAnnounce(ctx *gortsplib.ServerHandlerOnAnnounceCtx) (*base.Response, error) {
	if !s.authorized(ctx.Conn, ctx.Request) {
		return &base.Response{StatusCode: base.StatusUnauthorized}, liberrors.ErrServerAuth{}
	}

	path := streamPath(ctx.Path)
	s.mu.Lock()
	ss := s.streams[path]
	s.mu.Unlock()

	// Only a playback this server started may publish. Without this the server
	// would accept a stream from anything that can reach the port.
	if ss == nil || !isEventPath(path) {
		s.lg.Printf("refusing to publish %s: nothing is waiting for it", path)
		return &base.Response{StatusCode: base.StatusNotFound}, fmt.Errorf("no playback waiting for %s", path)
	}

	stream := &gortsplib.ServerStream{
		Server: s.srv,
		Desc:   &description.Session{Medias: ctx.Description.Medias},
	}
	if err := stream.Initialize(); err != nil {
		return &base.Response{StatusCode: base.StatusInternalServerError}, err
	}

	ss.mu.Lock()
	ss.stream = stream
	ss.publisher = ctx.Session
	ss.mu.Unlock()

	s.mu.Lock()
	s.publishers[ctx.Session] = ss
	s.mu.Unlock()

	ss.finish(nil)
	return &base.Response{StatusCode: base.StatusOK}, nil
}

// OnRecord forwards everything the publisher sends to the readers.
func (s *streamServer) OnRecord(ctx *gortsplib.ServerHandlerOnRecordCtx) (*base.Response, error) {
	path := streamPath(ctx.Path)
	s.mu.Lock()
	ss := s.streams[path]
	s.mu.Unlock()
	if ss == nil {
		return &base.Response{StatusCode: base.StatusNotFound}, fmt.Errorf("nothing to record into for %s", path)
	}

	ctx.Session.OnPacketRTPAny(func(medi *description.Media, _ format.Format, pkt *rtp.Packet) {
		stream := ss.serverStream()
		if stream == nil {
			return
		}
		_ = stream.WritePacketRTP(medi, pkt)
	})

	return &base.Response{StatusCode: base.StatusOK}, nil
}
