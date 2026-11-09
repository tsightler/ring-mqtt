package main

import "math/bits"

// HEVC parameter set extraction and SPS parsing, mirroring what h264.go and
// sps.go do for AVC. Without this the keyframe and resolution change counters
// are blind on HEVC streams, and a resolution change mid-stream is exactly the
// thing hardware decoders tend to fall over on.

type hevcSPSInfo struct {
	separateColourPlane bool
	log2MaxPicOrderCnt  uint
	maxNumReorderPics   uint
	picSizeInCtbsY      uint
	sliceAddrBits       int
	valid               bool
}

type hevcPPSInfo struct {
	ppsID                         uint
	dependentSliceSegmentsEnabled bool
	outputFlagPresent             bool
	numExtraSliceHeaderBits       uint
	valid                         bool
}

type hevcSliceInfo struct {
	firstSlice bool
	dependent  bool
	sliceAddr  uint
	poc        uint
	isIRAP     bool
	ok         bool
}

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
	width, height, _, ok = hevcDecodeSPS(sps)
	return width, height, ok
}

// hevcParseSPS extracts the SPS fields needed to validate slice headers and
// Picture Order Count continuity.
func hevcParseSPS(sps []byte) hevcSPSInfo {
	_, _, info, _ := hevcDecodeSPS(sps)
	return info
}

func hevcDecodeSPS(sps []byte) (width, height int, info hevcSPSInfo, ok bool) {
	if len(sps) < 4 {
		return 0, 0, hevcSPSInfo{}, false
	}

	r := &bitReader{data: unescape(sps[2:])} // skip the two byte NAL header

	r.bits(4) // sps_video_parameter_set_id
	maxSubLayersMinus1 := r.bits(3)
	r.bit() // sps_temporal_id_nesting_flag

	// profile_tier_level. Sub layer information is only present when there is
	// more than one layer, which Ring does not use; bail rather than misparse.
	if maxSubLayersMinus1 != 0 {
		return 0, 0, hevcSPSInfo{}, false
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
	var separateColourPlane bool
	if chromaFormat == 3 {
		separateColourPlane = r.bit() == 1 // separate_colour_plane_flag
	}

	rawWidth := int(r.ue())  // pic_width_in_luma_samples
	rawHeight := int(r.ue()) // pic_height_in_luma_samples
	width, height = rawWidth, rawHeight

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
		return 0, 0, hevcSPSInfo{}, false
	}

	r.ue() // bit_depth_luma_minus8
	r.ue() // bit_depth_chroma_minus8
	log2MaxPOCMinus4 := r.ue()
	if log2MaxPOCMinus4 > 12 {
		return width, height, hevcSPSInfo{}, true
	}

	r.bit() // sps_sub_layer_ordering_info_present_flag
	r.ue()  // sps_max_dec_pic_buffering_minus1[0]
	maxNumReorderPics := r.ue()
	r.ue() // sps_max_latency_increase_plus1[0]

	log2MinCbSizeY := r.ue() + 3 // log2_min_luma_coding_block_size_minus3 + 3
	log2DiffMaxMinCbSizeY := r.ue()
	ctbLog2SizeY := log2MinCbSizeY + log2DiffMaxMinCbSizeY
	if r.pos <= len(r.data)*8 && ctbLog2SizeY >= 4 && ctbLog2SizeY <= 6 {
		ctbSizeY := 1 << ctbLog2SizeY
		picWidthInCtbsY := uint((rawWidth + ctbSizeY - 1) / ctbSizeY)
		picHeightInCtbsY := uint((rawHeight + ctbSizeY - 1) / ctbSizeY)
		picSizeInCtbsY := picWidthInCtbsY * picHeightInCtbsY
		if picSizeInCtbsY > 0 {
			info = hevcSPSInfo{
				separateColourPlane: separateColourPlane,
				log2MaxPicOrderCnt:  log2MaxPOCMinus4 + 4,
				maxNumReorderPics:   maxNumReorderPics,
				picSizeInCtbsY:      picSizeInCtbsY,
				sliceAddrBits:       bits.Len(picSizeInCtbsY - 1),
				valid:               true,
			}
		}
	}

	return width, height, info, true
}

// hevcParsePPS extracts the leading PPS flags needed to parse slice headers.
func hevcParsePPS(pps []byte) hevcPPSInfo {
	if len(pps) < 3 {
		return hevcPPSInfo{}
	}
	r := &bitReader{data: unescape(pps[2:])}
	ppsID := r.ue()
	_ = r.ue() // pps_seq_parameter_set_id
	dep := r.bit() == 1
	outFlag := r.bit() == 1
	extraBits := r.bits(3)
	if r.pos > len(r.data)*8 {
		return hevcPPSInfo{}
	}
	return hevcPPSInfo{
		ppsID:                         ppsID,
		dependentSliceSegmentsEnabled: dep,
		outputFlagPresent:             outFlag,
		numExtraSliceHeaderBits:       extraBits,
		valid:                         true,
	}
}

// hevcInspectSlice parses the slice segment header of an HEVC VCL RTP packet
// (either a single NAL unit or the start fragment of an FU).
func hevcInspectSlice(payload []byte, sps hevcSPSInfo, pps hevcPPSInfo) hevcSliceInfo {
	if !sps.valid || !pps.valid || len(payload) < 3 {
		return hevcSliceInfo{}
	}

	nalType := (payload[0] >> 1) & 0x3F
	sliceHdr := payload[2:]
	if nalType == h265FU {
		if len(payload) < 4 || payload[2]&0x80 == 0 {
			return hevcSliceInfo{}
		}
		nalType = payload[2] & 0x3F
		sliceHdr = payload[3:]
	}

	isIRAP := nalType >= h265IRAPFirst && nalType <= h265IRAPLast
	if nalType > h265SliceMax && !isIRAP {
		return hevcSliceInfo{}
	}

	limit := len(sliceHdr)
	if limit > 32 {
		limit = 32
	}
	r := &bitReader{data: unescape(sliceHdr[:limit])}

	firstSlice := r.bit() == 1
	if nalType >= h265IRAPFirst && nalType <= 23 {
		r.bit() // no_output_of_prior_pics_flag
	}
	if r.ue() != pps.ppsID {
		return hevcSliceInfo{}
	}

	var (
		dependent bool
		sliceAddr uint
	)
	if !firstSlice {
		if pps.dependentSliceSegmentsEnabled {
			dependent = r.bit() == 1
		}
		if sps.sliceAddrBits > 0 {
			sliceAddr = r.bits(sps.sliceAddrBits)
		}
		if sliceAddr == 0 || sliceAddr >= sps.picSizeInCtbsY {
			return hevcSliceInfo{}
		}
	}

	var poc uint
	if !dependent {
		if pps.numExtraSliceHeaderBits > 0 {
			r.bits(int(pps.numExtraSliceHeaderBits))
		}
		sliceType := r.ue() // 0=B, 1=P, 2=I
		if sliceType > 2 {
			return hevcSliceInfo{}
		}
		if pps.outputFlagPresent {
			r.bit() // pic_output_flag
		}
		if sps.separateColourPlane {
			r.bits(2) // colour_plane_id
		}
		if nalType != 19 && nalType != 20 {
			poc = r.bits(int(sps.log2MaxPicOrderCnt))
		}
	}

	if r.pos > len(r.data)*8 {
		return hevcSliceInfo{}
	}
	return hevcSliceInfo{
		firstSlice: firstSlice,
		dependent:  dependent,
		sliceAddr:  sliceAddr,
		poc:        poc,
		isIRAP:     isIRAP,
		ok:         true,
	}
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
