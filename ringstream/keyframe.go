package main

// Random access point detection for both codecs. Anything sent to ffmpeg before
// the first keyframe decodes to garbage, which H.264 mostly conceals but HEVC
// renders as green blocks, so video is withheld until one of these arrives.

// H.264 NAL unit types
const (
	h264IDR   = 5
	h264SPS   = 7
	h264PPS   = 8
	h264STAPA = 24
	h264FUA   = 28
)

// H.265 NAL unit types
const (
	h265IRAPFirst = 16 // BLA_W_LP
	h265IRAPLast  = 21 // CRA_NUT
	h265VPS       = 32
	h265SPS       = 33
	h265PPS       = 34
	h265AP        = 48
	h265FU        = 49
)

func h264IsRAP(nalType byte) bool {
	return nalType == h264IDR || nalType == h264SPS || nalType == h264PPS
}

func h265IsRAP(nalType byte) bool {
	if nalType >= h265IRAPFirst && nalType <= h265IRAPLast {
		return true
	}
	return nalType == h265VPS || nalType == h265SPS || nalType == h265PPS
}

// isRandomAccessPoint reports whether an RTP payload begins a keyframe or
// carries the parameter sets needed to decode one.
func isRandomAccessPoint(payload []byte, h265 bool) bool {
	if len(payload) < 1 {
		return false
	}

	if !h265 {
		switch nalType := payload[0] & 0x1F; nalType {
		case h264STAPA:
			// 1 byte header, then repeated (2 byte length, NAL unit)
			buf := payload[1:]
			for len(buf) >= 2 {
				size := int(buf[0])<<8 | int(buf[1])
				buf = buf[2:]
				if size == 0 || size > len(buf) {
					break
				}
				if h264IsRAP(buf[0] & 0x1F) {
					return true
				}
				buf = buf[size:]
			}
			return false
		case h264FUA:
			// only the first fragment starts a NAL unit
			if len(payload) < 2 || payload[1]&0x80 == 0 {
				return false
			}
			return h264IsRAP(payload[1] & 0x1F)
		default:
			return h264IsRAP(nalType)
		}
	}

	if len(payload) < 2 {
		return false
	}
	switch nalType := (payload[0] >> 1) & 0x3F; nalType {
	case h265AP:
		// 2 byte payload header, then repeated (2 byte length, NAL unit)
		buf := payload[2:]
		for len(buf) >= 2 {
			size := int(buf[0])<<8 | int(buf[1])
			buf = buf[2:]
			if size < 2 || size > len(buf) {
				break
			}
			if h265IsRAP((buf[0] >> 1) & 0x3F) {
				return true
			}
			buf = buf[size:]
		}
		return false
	case h265FU:
		// 2 byte payload header, 1 byte FU header carrying the original type
		if len(payload) < 3 || payload[2]&0x80 == 0 {
			return false
		}
		return h265IsRAP(payload[2] & 0x3F)
	default:
		return h265IsRAP(nalType)
	}
}
