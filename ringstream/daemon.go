package main

import (
	"log"
	"os"
	"os/signal"
	"syscall"
)

// runDaemon serves every camera from one process for the lifetime of the addon,
// replacing the process-per-stream model that needed go2rtc to run a shell
// script to bring a stream up.
func runDaemon(lg *log.Logger, controlURL, rtspAddr, rtspUser, rtspPass, ffmpegPath string) error {
	ctl := newControl(lg, controlURL)
	srv := newStreamServer(lg, rtspAddr, rtspUser, rtspPass, ctl.activate(ffmpegPath))
	srv.activateEvent = ctl.activateEvent(ffmpegPath)

	// The MQTT stream switch can still turn a camera on with nothing watching
	// it, which RTSP activation alone does not cover.
	ctl.onStart = func(path string) { srv.pin(path) }
	ctl.onStop = func(path string) { srv.unpin(path) }

	if err := srv.start(); err != nil {
		return err
	}
	defer srv.close()

	stop := make(chan struct{})
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		lg.Printf("signal received, shutting down")
		close(stop)
	}()

	ctl.run(stop)
	return nil
}
