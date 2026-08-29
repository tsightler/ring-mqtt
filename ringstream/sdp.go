package main

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	reAudioPort = regexp.MustCompile(`m=audio \d+`)
	reVideoPort = regexp.MustCompile(`m=video \d+`)
)

// cleanSDP turns Ring's WebRTC answer into something ffmpeg's sdp demuxer will
// accept: everything before the first media section is dropped and the ports
// are rewritten to the local sockets we send RTP to. This is what ring-mqtt did
// in JavaScript before this helper existed; ffmpeg ignores the leftover ICE and
// DTLS attributes.
func cleanSDP(answer string, videoPort, audioPort int) string {
	parts := strings.Split(answer, "\nm=")
	if len(parts) < 2 {
		return ""
	}

	var b strings.Builder
	for i, p := range parts[1:] {
		if i > 0 {
			b.WriteString("\n")
		}
		b.WriteString("m=")
		b.WriteString(p)
	}

	out := b.String()
	out = reAudioPort.ReplaceAllString(out, fmt.Sprintf("m=audio %d", audioPort))
	out = reVideoPort.ReplaceAllString(out, fmt.Sprintf("m=video %d", videoPort))
	return out
}
