package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// sessionConfig is everything one Ring stream needs. It exists so the same
// logic can be driven either from the command line for a single stream or, in
// daemon mode, from the control socket for many at once.
type sessionConfig struct {
	// name identifies this stream in the log. A daemon interleaves the output
	// of every active camera, so without it the lines cannot be told apart.
	name string
	lg   *log.Logger

	ticket     string
	cameraID   int
	publishURL string
	videoCodec string
	h265Fmtp   string
	transport  string

	reorderWait  time.Duration
	reorderMax   time.Duration
	reorderDepth int
	ffmpegPath   string

	ffmpegStats bool
	trackWait   time.Duration

	// newSink overrides where packets go once the track descriptions are known.
	// The daemon serves them from its own RTSP server rather than publishing
	// them to someone else's; when nil the one shot publisher is used.
	newSink func(v *videoSpec, a *audioSpec) (sink, error)

	// state reports the stream's lifecycle. The one shot path writes it to
	// stdout for the supervising worker to parse; the daemon reports it over
	// the control socket instead.
	state func(string)
}

// Defaults belong here rather than on the flags alone. The daemon builds a
// sessionConfig per camera as a struct literal and never sees a flag, so a
// default that lives only on the flag reaches the one shot path and nothing
// else. That is how the reorder buffer came to be disabled in the only mode
// that runs in production.
const (
	// The floor is what a camera on the same network needs; the ceiling is what
	// one on another continent needs, where a NACK round trip runs to a few
	// hundred milliseconds. The wait sits wherever measured repairs put it, so
	// a nearby camera never pays for a distant one.
	defaultReorderWait  = 50 * time.Millisecond
	defaultReorderMax   = 400 * time.Millisecond
	defaultReorderDepth = 512
)

func (c *sessionConfig) validate() error {
	if c.lg == nil {
		c.lg = newSessionLogger(c.name)
	}
	switch {
	case c.reorderWait == 0:
		c.reorderWait = defaultReorderWait
	case c.reorderWait < 0:
		c.reorderWait = 0 // negative asks for straight through forwarding
	}
	if c.reorderMax <= 0 {
		c.reorderMax = defaultReorderMax
	}
	if c.reorderMax < c.reorderWait {
		c.reorderMax = c.reorderWait
	}
	if c.reorderDepth <= 0 {
		c.reorderDepth = defaultReorderDepth
	}
	if c.state == nil {
		c.state = func(s string) { fmt.Println("status " + s) }
	}
	if c.videoCodec != "h264" && c.videoCodec != "h265" {
		return fmt.Errorf("unknown video codec %q, expected h264 or h265", c.videoCodec)
	}
	// Publishing straight to the RTSP server describes the track as H.264 and
	// parses H.264 parameter sets, neither of which understands HEVC.
	if c.transport != "direct" && c.transport != "rtsp" && c.transport != "udp" {
		return fmt.Errorf("unknown transport %q, expected direct, rtsp or udp", c.transport)
	}
	if c.transport != "direct" && c.ffmpegPath == "" {
		return errors.New("a path to ffmpeg (-ffmpeg or RING_FFMPEG) is required")
	}
	if c.ticket == "" || c.cameraID == 0 {
		return errors.New("a ticket (-ticket or RING_TICKET) and -camera-id are both required")
	}
	// A session serving its own readers has nowhere to publish to, so the URL
	// is only required when the default publishing sink is in use.
	if c.newSink == nil && c.publishURL == "" {
		return errors.New("-publish-url is required unless the session serves its own readers")
	}
	return nil
}

func main() {
	log.SetFlags(log.Ltime | log.Lmicroseconds)

	var cfg sessionConfig
	daemon := flag.Bool("daemon", false, "serve every camera from one process, taking commands from ring-mqtt over the control socket")
	controlURL := flag.String("control-url", "ws://127.0.0.1:51883/ringstream", "ring-mqtt control socket")
	rtspListen := flag.String("rtsp-listen", ":8554", "address the RTSP server listens on; this is the URL advertised to Home Assistant and to RTSP clients")
	rtspUser := flag.String("rtsp-user", "", "username readers must present, empty disables authentication")
	rtspPass := flag.String("rtsp-pass", "", "password readers must present, empty disables authentication")
	flag.StringVar(&cfg.name, "name", "", "camera name used as a log prefix")
	flag.StringVar(&cfg.ticket, "ticket", "", "Ring signaling session ticket")
	flag.IntVar(&cfg.cameraID, "camera-id", 0, "Ring doorbot id")
	flag.StringVar(&cfg.publishURL, "publish-url", "", "RTSP URL to publish to")
	flag.DurationVar(&cfg.trackWait, "track-wait", 5*time.Second, "how long to wait for tracks before publishing")
	flag.StringVar(&cfg.videoCodec, "video-codec", "h264", "video codec to offer Ring: h264 or h265")
	flag.DurationVar(&cfg.reorderWait, "reorder-wait", 0, "shortest time to hold a video sequence gap open for a retransmission; the wait grows from here as repairs are measured. 0 uses the default, negative forwards packets straight through")
	flag.DurationVar(&cfg.reorderMax, "reorder-max", 0, "longest a video sequence gap may be held, bounding the latency a distant camera can add; 0 uses the default")
	flag.IntVar(&cfg.reorderDepth, "reorder-depth", 0, "packets that may be held while waiting on a gap; 0 uses the default")
	flag.StringVar(&cfg.h265Fmtp, "h265-fmtp", "", "fmtp offered to Ring for H.265; empty lets Ring choose, which is what the native client does")
	flag.StringVar(&cfg.transport, "transport", "direct", "\"rtsp\" publishes to ffmpeg over TCP, \"udp\" sends it RTP with an SDP on stdin, \"direct\" skips ffmpeg entirely and publishes Ring's own packets to the RTSP server (no AAC track)")
	flag.BoolVar(&cfg.ffmpegStats, "ffmpeg-stats", false, "log ffmpeg's periodic progress line")
	flag.StringVar(&cfg.ffmpegPath, "ffmpeg", "", "path to ffmpeg; when set, publish through it so an AAC track is produced alongside Opus (env RING_FFMPEG)")
	flag.Parse()

	if cfg.ticket == "" {
		// Prefer the environment so the ticket stays out of ps output.
		cfg.ticket = os.Getenv("RING_TICKET")
	}
	if cfg.ffmpegPath == "" {
		cfg.ffmpegPath = os.Getenv("RING_FFMPEG")
	}

	if *daemon {
		if err := runDaemon(defaultLogger, *controlURL, *rtspListen, *rtspUser, *rtspPass, cfg.ffmpegPath); err != nil {
			log.Printf("%v", err)
			os.Exit(1)
		}
		return
	}

	stopReq := make(chan struct{})
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		log.Printf("signal received, stopping")
		close(stopReq)
	}()

	if err := runSession(cfg, stopReq); err != nil {
		log.Printf("%v", err)
		os.Exit(1)
	}
}
