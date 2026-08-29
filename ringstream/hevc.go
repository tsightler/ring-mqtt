package main

// HEVC parameter set extraction and SPS parsing, mirroring what h264.go and
// sps.go do for AVC. Without this the keyframe and resolution change counters
// are blind on HEVC streams, and a resolution change mid-stream is exactly the
// thing hardware decoders tend to fall over on.

// hevcExtractSPS returns the SPS NAL unit carried by an RTP payload, if any.
// Parameter sets arrive either as single NAL units or inside an aggregation
// packet; they are small enough that they are never fragmented in practice.
func hevcExtractSPS(payload []byte) []byte {
	if len(payload) < 2 {
		return nil
	}

	switch nalType := (payload[0] >> 1) & 0x3F; nalType {
	case h265SPS:
		return payload

	case h265AP:
		// 2 byte payload header, then repeated (2 byte length, NAL unit)
		buf := payload[2:]
		for len(buf) >= 2 {
			size := int(buf[0])<<8 | int(buf[1])
			buf = buf[2:]
			if size < 2 || size > len(buf) {
				break
			}
			if (buf[0]>>1)&0x3F == h265SPS {
				return buf[:size]
			}
			buf = buf[size:]
		}
	}
	return nil
}

// hevcResolution returns the display dimensions coded in an HEVC SPS.
func hevcResolution(sps []byte) (width, height int, ok bool) {
	if len(sps) < 4 {
		return 0, 0, false
	}

	r := &bitReader{data: unescape(sps[2:])} // skip the two byte NAL header

	r.bits(4) // sps_video_parameter_set_id
	maxSubLayersMinus1 := r.bits(3)
	r.bit() // sps_temporal_id_nesting_flag

	// profile_tier_level. Sub layer information is only present when there is
	// more than one layer, which Ring does not use; bail rather than misparse.
	if maxSubLayersMinus1 != 0 {
		return 0, 0, false
	}
	r.bits(2)  // general_profile_space
	r.bit()    // general_tier_flag
	r.bits(5)  // general_profile_idc
	r.bits(32) // general_profile_compatibility_flag
	r.bits(4)  // progressive, interlaced, non_packed, frame_only
	r.bits(43) // reserved
	r.bit()    // reserved
	r.bits(8)  // general_level_idc

	r.ue() // sps_seq_parameter_set_id

	chromaFormat := r.ue()
	if chromaFormat == 3 {
		r.bit() // separate_colour_plane_flag
	}

	width = int(r.ue())  // pic_width_in_luma_samples
	height = int(r.ue()) // pic_height_in_luma_samples

	if r.bit() == 1 { // conformance_window_flag
		subW, subH := 1, 1
		switch chromaFormat {
		case 1:
			subW, subH = 2, 2
		case 2:
			subW = 2
		}
		left, right := int(r.ue()), int(r.ue())
		top, bottom := int(r.ue()), int(r.ue())
		width -= (left + right) * subW
		height -= (top + bottom) * subH
	}

	if width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

// hevcParameterSets returns any VPS, SPS or PPS carried by an RTP payload. The
// RTSP track description needs all three up front, unlike the SDP demuxer which
// picks them up from the bitstream.
func hevcParameterSets(payload []byte) (vps, sps, pps []byte) {
	take := func(nal []byte) {
		if len(nal) < 2 {
			return
		}
		switch (nal[0] >> 1) & 0x3F {
		case h265VPS:
			vps = nal
		case h265SPS:
			sps = nal
		case h265PPS:
			pps = nal
		}
	}

	if len(payload) < 2 {
		return nil, nil, nil
	}

	switch (payload[0] >> 1) & 0x3F {
	case h265AP:
		buf := payload[2:]
		for len(buf) >= 2 {
			size := int(buf[0])<<8 | int(buf[1])
			buf = buf[2:]
			if size < 2 || size > len(buf) {
				break
			}
			take(buf[:size])
			buf = buf[size:]
		}
	default:
		take(payload)
	}
	return vps, sps, pps
}
