package main

import (
	"fmt"
	"time"

	"github.com/bluenviron/gortsplib/v5/pkg/description"
	"github.com/bluenviron/gortsplib/v5/pkg/format"
	"github.com/pion/rtp"
)

// sink is where a session's packets go once the track descriptions are known.
// A session builds its parameter sets from the stream itself, so the sink
// cannot exist until the first keyframe has been parsed. The one shot path
// publishes to an RTSP server as a client; the daemon serves readers from its
// own server.
type sink interface {
	// waitReady blocks until the sink can actually deliver, or the timeout
	// expires. A server serving its own readers cannot deliver anything until
	// one has finished SETUP and PLAY: gortsplib fans out to whoever is attached
	// at the time of the write and keeps no history, so a keyframe published
	// before that goes nowhere and the reader opens mid GOP on undecodable data.
	waitReady(time.Duration)

	writeVideo(*rtp.Packet, time.Time) error
	writeAudio(*rtp.Packet, time.Time) error
	close()
}

// buildMedias turns the parameter sets collected from the stream into RTSP
// media descriptions. Both sinks need exactly the same description, so it lives
// apart from either of them.
func buildMedias(v *videoSpec, a *audioSpec) (video, audio *description.Media, err error) {
	if v != nil {
		var f format.Format
		if v.h265 {
			f = &format.H265{
				PayloadTyp: v.payloadType,
				VPS:        v.vps,
				SPS:        v.sps,
				PPS:        v.pps,
			}
		} else {
			f = &format.H264{
				PayloadTyp:        v.payloadType,
				SPS:               v.sps,
				PPS:               v.pps,
				PacketizationMode: 1,
			}
		}
		video = &description.Media{Type: description.MediaTypeVideo, Formats: []format.Format{f}}
	}

	if a != nil {
		var f format.Format
		if a.isOpus {
			f = &format.Opus{PayloadTyp: a.payloadType, ChannelCount: a.channels}
		} else {
			f = &format.G711{PayloadTyp: a.payloadType, MULaw: true, SampleRate: 8000, ChannelCount: 1}
		}
		audio = &description.Media{Type: description.MediaTypeAudio, Formats: []format.Format{f}}
	}

	if video == nil && audio == nil {
		return nil, nil, fmt.Errorf("no tracks to publish")
	}
	return video, audio, nil
}

// mediaList returns the descriptions in the order a session description needs
// them, skipping whichever track is absent.
func mediaList(video, audio *description.Media) []*description.Media {
	var medias []*description.Media
	if video != nil {
		medias = append(medias, video)
	}
	if audio != nil {
		medias = append(medias, audio)
	}
	return medias
}
