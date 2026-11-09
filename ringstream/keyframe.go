package main

// Random access point detection for both codecs. Anything sent to ffmpeg before
// the first keyframe decodes to garbage, which H.264 mostly conceals but HEVC
// renders as green blocks, so video is withheld until one of these arrives.

// H.264 NAL unit types
const (
	h264SliceMin = 1
	h264IDR      = 5
	h264SEI      = 6
	h264SPS      = 7
	h264PPS      = 8
	h264AUD      = 9
	h264STAPA    = 24
	h264FUA      = 28
)

// H.265 NAL unit types
const (
	h265SliceMax  = 9  // RASL_R
	h265IRAPFirst = 16 // BLA_W_LP
	h265IRAPLast  = 21 // CRA_NUT
	h265VPS       = 32
	h265SPS       = 33
	h265PPS       = 34
	h265AUD       = 35
	h265PrefixSEI = 39
	h265SuffixSEI = 40
	h265AP        = 48
	h265FU        = 49
)

// Only the head of a parameter-set run (VPS for HEVC, SPS for AVC) or a
// keyframe slice itself may begin a random access point. Accepting SPS/PPS on
// HEVC or PPS on AVC starts forwarding midway through a parameter-set run when
// the leading VPS or SPS was lost.
func h264IsRAP(nalType byte) bool {
	return nalType == h264IDR || nalType == h264SPS
}

func h265IsRAP(nalType byte) bool {
	if nalType >= h265IRAPFirst && nalType <= h265IRAPLast {
		return true
	}
	return nalType == h265VPS
}

// isRandomAccessPoint reports whether an RTP payload begins a keyframe or
// the parameter-set run that precedes one.
func isRandomAccessPoint(payload []byte, h265 bool) bool {
	return inspectPayload(payload, h265).startsRAP
}

// nalInfo classifies an RTP video payload so resync can assemble complete
// frames and avoid handing half-fragmented slices or orphaned parameter sets
// to a hardware decoder.
type nalInfo struct {
	startsRAP       bool // begins a keyframe or its leading parameter-set run
	startsParamRun  bool // begins a parameter-set run (VPS for HEVC, SPS for AVC)
	isParam         bool // parameter set or non-VCL prefix (VPS, SPS, PPS, AUD, SEI)
	isVCL           bool // carries coded slice data (IDR/IRAP or predicted slice)
	isIRAP          bool // carries an IDR or IRAP keyframe slice
	isFU            bool // fragmentation unit (FU-A for AVC, FU for HEVC)
	fuStart         bool // first fragment of an FU (S bit)
	fuEnd           bool // final fragment of an FU (E bit)
	vclStarts       int  // number of VCL slices that begin in this packet
	hasSliceHdr     bool // true when the VCL slice header byte is present
	firstSliceInPic bool // HEVC first_slice_segment_in_pic_flag on the first VCL slice in this packet
}

func classifyH264NAL(nalType byte, info *nalInfo) {
	switch {
	case nalType == h264IDR:
		info.startsRAP = true
		info.isVCL = true
		info.isIRAP = true
	case nalType >= h264SliceMin && nalType < h264IDR:
		info.isVCL = true
	case nalType == h264SPS:
		info.startsRAP = true
		info.startsParamRun = true
		info.isParam = true
	case nalType == h264PPS || nalType == h264SEI || nalType == h264AUD:
		info.isParam = true
	}
}

func classifyH265NAL(nalType byte, info *nalInfo) {
	switch {
	case nalType >= h265IRAPFirst && nalType <= h265IRAPLast:
		info.startsRAP = true
		info.isVCL = true
		info.isIRAP = true
	case nalType <= h265SliceMax:
		info.isVCL = true
	case nalType == h265VPS:
		info.startsRAP = true
		info.startsParamRun = true
		info.isParam = true
	case nalType == h265SPS || nalType == h265PPS || nalType == h265AUD ||
		nalType == h265PrefixSEI || nalType == h265SuffixSEI:
		info.isParam = true
	}
}

func inspectPayload(payload []byte, h265 bool) nalInfo {
	var info nalInfo
	if len(payload) < 1 {
		return info
	}

	if !h265 {
		switch nalType := payload[0] & 0x1F; nalType {
		case h264STAPA:
			buf := payload[1:]
			for len(buf) >= 2 {
				size := int(buf[0])<<8 | int(buf[1])
				buf = buf[2:]
				if size == 0 || size > len(buf) {
					break
				}
				nt := buf[0] & 0x1F
				classifyH264NAL(nt, &info)
				if nt >= h264SliceMin && nt <= h264IDR {
					info.vclStarts++
				}
				buf = buf[size:]
			}
		case h264FUA:
			info.isFU = true
			if len(payload) >= 2 {
				info.fuStart = payload[1]&0x80 != 0
				info.fuEnd = payload[1]&0x40 != 0
				inner := payload[1] & 0x1F
				info.isIRAP = inner == h264IDR
				info.isVCL = inner >= h264SliceMin && inner <= h264IDR
				info.startsRAP = info.fuStart && h264IsRAP(inner)
				if info.isVCL && info.fuStart {
					info.vclStarts = 1
				}
			}
		default:
			classifyH264NAL(nalType, &info)
			if info.isVCL {
				info.vclStarts = 1
			}
		}
		return info
	}

	if len(payload) < 2 {
		return info
	}
	switch nalType := (payload[0] >> 1) & 0x3F; nalType {
	case h265AP:
		buf := payload[2:]
		for len(buf) >= 2 {
			size := int(buf[0])<<8 | int(buf[1])
			buf = buf[2:]
			if size < 2 || size > len(buf) {
				break
			}
			nal := buf[:size]
			nt := (nal[0] >> 1) & 0x3F
			wasVCL := info.isVCL
			classifyH265NAL(nt, &info)
			if nt <= h265SliceMax || (nt >= h265IRAPFirst && nt <= h265IRAPLast) {
				info.vclStarts++
				if !wasVCL && len(nal) >= 3 {
					info.hasSliceHdr = true
					info.firstSliceInPic = nal[2]&0x80 != 0
				}
			}
			buf = buf[size:]
		}
	case h265FU:
		info.isFU = true
		if len(payload) >= 3 {
			info.fuStart = payload[2]&0x80 != 0
			info.fuEnd = payload[2]&0x40 != 0
			inner := payload[2] & 0x3F
			info.isIRAP = inner >= h265IRAPFirst && inner <= h265IRAPLast
			info.isVCL = inner <= h265SliceMax || info.isIRAP
			info.startsRAP = info.fuStart && h265IsRAP(inner)
			if info.isVCL && info.fuStart {
				info.vclStarts = 1
				if len(payload) >= 4 {
					info.hasSliceHdr = true
					info.firstSliceInPic = payload[3]&0x80 != 0
				}
			}
		}
	default:
		classifyH265NAL(nalType, &info)
		if info.isVCL {
			info.vclStarts = 1
			if len(payload) >= 3 {
				info.hasSliceHdr = true
				info.firstSliceInPic = payload[2]&0x80 != 0
			}
		}
	}
	return info
}
