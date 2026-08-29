package main

// Opus TOC (table of contents) parsing. The first payload byte says how long
// each frame is and how many frames the packet carries, which determines
// whether a long packet can be split into shorter ones without re-encoding.

// frameDurations is indexed by the 5 bit config value in the TOC byte.
var frameDurations = [32]float64{
	10, 20, 40, 60, // SILK narrowband
	10, 20, 40, 60, // SILK mediumband
	10, 20, 40, 60, // SILK wideband
	10, 20, // Hybrid super-wideband
	10, 20, // Hybrid fullband
	2.5, 5, 10, 20, // CELT narrowband
	2.5, 5, 10, 20, // CELT wideband
	2.5, 5, 10, 20, // CELT super-wideband
	2.5, 5, 10, 20, // CELT fullband
}

// opusFraming reports the per-frame duration and frame count of a packet.
// splittable is true when the packet holds several frames that could be
// repacketized individually; a single long frame cannot be divided.
func opusFraming(payload []byte) (frameMS float64, frames int, splittable bool, ok bool) {
	if len(payload) < 1 {
		return 0, 0, false, false
	}

	config := payload[0] >> 3
	code := payload[0] & 0x03
	frameMS = frameDurations[config]

	switch code {
	case 0:
		frames = 1
	case 1, 2:
		frames = 2
	case 3:
		if len(payload) < 2 {
			return 0, 0, false, false
		}
		frames = int(payload[1] & 0x3F)
	}

	return frameMS, frames, frames > 1, true
}
