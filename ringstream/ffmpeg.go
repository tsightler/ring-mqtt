package main

import (
	"bufio"
	"bytes"
	"fmt"
	"log"
	"os/exec"
	"strings"
	"time"

	"github.com/pion/rtp"
)

// lineBreaks holds CR and LF. ffmpeg rewrites its progress line with a carriage
// return rather than a newline, so a newline-only scanner holds every update
// until the process exits and then emits the whole lot at once.
var lineBreaks = string([]byte{13, 10})

func scanLinesCR(data []byte, atEOF bool) (int, []byte, error) {
	if atEOF && len(data) == 0 {
		return 0, nil, nil
	}
	if i := bytes.IndexAny(data, lineBreaks); i >= 0 {
		return i + 1, data[:i], nil
	}
	if atEOF {
		return len(data), data, nil
	}
	return 0, nil, nil
}

// ffmpegRelay reproduces the pipeline ring-mqtt used before this helper: RTP is
// sent to ffmpeg over loopback UDP with Ring's own SDP on stdin, and ffmpeg
// copies video while publishing audio twice, as AAC and as Opus. Keeping the
// transport identical means the RTSP server and every client downstream see
// exactly what five years of releases have given them.
type ffmpegRelay struct {
	cmd   *exec.Cmd
	video *udpTrack
	audio *udpTrack
}

// startFfmpegListen runs ffmpeg waiting for an RTSP publish from this process
// rather than reading RTP from UDP sockets. TCP applies back pressure, so a
// momentary stall in ffmpeg cannot cost packets the way an overrun receive
// buffer does.
func startFfmpegListen(lg *log.Logger, ffmpegPath, publishURL string, usingOpus, stats bool) (*ffmpegRelay, string, error) {
	lg = orDefault(lg)
	port, err := freeUDPPortPair()
	if err != nil {
		return nil, "", fmt.Errorf("reserve port: %w", err)
	}
	listenURL := fmt.Sprintf("rtsp://127.0.0.1:%d/ring", port)

	statsArg := "-nostats"
	if stats {
		statsArg = "-stats"
	}

	args := []string{"-hide_banner", statsArg, "-rtsp_flags", "listen", "-rtsp_transport", "tcp"}
	if usingOpus {
		args = append(args, "-acodec", "libopus")
	}
	args = append(args,
		"-i", listenURL,
		"-map", "0:v",
		"-map", "0:a",
		"-map", "0:a",
		"-c:a:0", "aac",
		"-c:a:1", "copy",
		"-c:v", "copy",
		"-bsf:v", "dump_extra=freq=keyframe",
		"-f", "rtsp",
		"-rtsp_transport", "tcp",
		publishURL,
	)

	cmd := exec.Command(ffmpegPath, args...)
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, "", fmt.Errorf("ffmpeg stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, "", fmt.Errorf("start ffmpeg: %w", err)
	}

	go func() {
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		sc.Split(scanLinesCR)
		for sc.Scan() {
			if line := strings.TrimSpace(sc.Text()); line != "" {
				lg.Printf("ffmpeg: %s", line)
			}
		}
	}()

	lg.Printf("ffmpeg listening on %s, publishing to %s", listenURL, publishURL)
	return &ffmpegRelay{cmd: cmd}, listenURL, nil
}

func startFfmpegRelay(lg *log.Logger, ffmpegPath, publishURL, answerSDP string, usingOpus, stats bool) (*ffmpegRelay, error) {
	videoPort, err := freeUDPPortPair()
	if err != nil {
		return nil, fmt.Errorf("reserve video port: %w", err)
	}
	audioPort, err := freeUDPPortPair()
	if err != nil {
		return nil, fmt.Errorf("reserve audio port: %w", err)
	}

	sdp := cleanSDP(answerSDP, videoPort, audioPort)
	if sdp == "" {
		return nil, fmt.Errorf("could not build an SDP from Ring's answer")
	}

	// The periodic progress line is noise in normal operation; -ffmpeg-stats
	// brings it back for diagnostics.
	statsArg := "-nostats"
	if stats {
		statsArg = "-stats"
	}

	args := []string{
		"-hide_banner",
		statsArg,
		"-protocol_whitelist", "pipe,udp,rtp,file,crypto",
		// A larger receive buffer, so the backlog drained at startup does not
		// overflow the socket and cost part of the first keyframe.
		"-buffer_size", "1048576",
	}
	if usingOpus {
		// Ring answers with either Opus or PCMU. ffmpeg's native Opus decoder
		// mangles this audio, so decode with libopus.
		args = append(args, "-acodec", "libopus")
	}
	args = append(args,
		"-f", "sdp",
		"-i", "pipe:",
		"-map", "0:v",
		"-map", "0:a",
		"-map", "0:a",
		"-c:a:0", "aac",
		"-c:a:1", "copy",
		"-c:v", "copy",
		// ffmpeg enables global headers for the RTSP muxer, which moves VPS, SPS
		// and PPS out of the bitstream and into the SDP alone. A player reading
		// the SDP is fine, but anything republishing this to WebRTC has to send
		// parameter sets in band, and a decoder that never receives them renders
		// green until it gives up. dump_extra puts them back in front of every
		// keyframe.
		"-bsf:v", "dump_extra=freq=keyframe",
		"-f", "rtsp",
		"-rtsp_transport", "tcp",
		publishURL,
	)

	cmd := exec.Command(ffmpegPath, args...)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stdin: %w", err)
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, fmt.Errorf("ffmpeg stderr: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start ffmpeg: %w", err)
	}

	relay := &ffmpegRelay{cmd: cmd}

	go func() {
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
		sc.Split(scanLinesCR)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			lg.Printf("ffmpeg: %s", line)
		}
	}()

	if _, err := stdin.Write([]byte(sdp)); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("write sdp: %w", err)
	}
	_ = stdin.Close()

	if relay.video, err = dialUDP(lg, "video", videoPort); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("dial video port: %w", err)
	}
	if relay.audio, err = dialUDP(lg, "audio", audioPort); err != nil {
		relay.video.close()
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("dial audio port: %w", err)
	}

	lg.Printf("ffmpeg relay: video rtp/%d audio rtp/%d, publishing to %s",
		videoPort, audioPort, publishURL)
	return relay, nil
}

func (f *ffmpegRelay) writeVideo(pkt *rtp.Packet, _ time.Time) error { return f.video.write(pkt) }
func (f *ffmpegRelay) writeAudio(pkt *rtp.Packet, _ time.Time) error { return f.audio.write(pkt) }

func (f *ffmpegRelay) stop() {
	if f == nil {
		return
	}
	f.video.close()
	f.audio.close()
	if f.cmd != nil && f.cmd.Process != nil {
		_ = f.cmd.Process.Kill()
		_, _ = f.cmd.Process.Wait()
	}
}
