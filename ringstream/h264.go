package main

// Minimal H.264 RTP payload inspection: just enough to recover the SPS and PPS
// that decoders need before they can make sense of any slice data. Ring does
// not always advertise them in the answer SDP, and without them clients emit
// "non-existing PPS referenced" until the next in-band keyframe arrives.

const (
	nalTypeSPS   = 7
	nalTypePPS   = 8
	nalTypeSTAPA = 24
)

// scanParameterSets returns any SPS/PPS carried by a single RTP payload.
// Parameter sets are small, so they arrive either as single NAL units or inside
// a STAP-A aggregate; they are never fragmented in practice.
func scanParameterSets(payload []byte) (sps, pps []byte) {
	if len(payload) < 1 {
		return nil, nil
	}

	switch payload[0] & 0x1F {
	case nalTypeSPS:
		return payload, nil

	case nalTypePPS:
		return nil, payload

	case nalTypeSTAPA:
		// 1 byte header, then repeated (2 byte length, NAL unit)
		buf := payload[1:]
		for len(buf) >= 2 {
			size := int(buf[0])<<8 | int(buf[1])
			buf = buf[2:]
			if size == 0 || size > len(buf) {
				break
			}
			nal := buf[:size]
			buf = buf[size:]
			switch nal[0] & 0x1F {
			case nalTypeSPS:
				sps = nal
			case nalTypePPS:
				pps = nal
			}
		}
	}
	return sps, pps
}

// h264ParameterSets returns any SPS or PPS carried by an RTP payload, for
// building the RTSP track description.
func h264ParameterSets(payload []byte) (sps, pps []byte) {
	return scanParameterSets(payload)
}
