package main

// Enough H.264 SPS parsing to recover the coded resolution, so that a change in
// SPS bytes can be told apart from an actual change in frame size. Only the
// former is safe to filter.

type bitReader struct {
	data []byte
	pos  int // bit position
}

func (r *bitReader) bit() uint {
	if r.pos>>3 >= len(r.data) {
		return 0
	}
	b := (r.data[r.pos>>3] >> (7 - uint(r.pos&7))) & 1
	r.pos++
	return uint(b)
}

func (r *bitReader) bits(n int) uint {
	var v uint
	for i := 0; i < n; i++ {
		v = v<<1 | r.bit()
	}
	return v
}

// ue reads an unsigned exp-Golomb coded value.
func (r *bitReader) ue() uint {
	zeros := 0
	for r.pos>>3 < len(r.data) && r.bit() == 0 {
		zeros++
		if zeros > 32 {
			return 0
		}
	}
	if zeros == 0 {
		return 0
	}
	return (1 << uint(zeros)) - 1 + r.bits(zeros)
}

// se reads a signed exp-Golomb coded value.
func (r *bitReader) se() int {
	v := r.ue()
	if v&1 == 1 {
		return int(v+1) / 2
	}
	return -int(v / 2)
}

// unescape removes emulation prevention bytes (0x03 inserted after 0x0000).
func unescape(b []byte) []byte {
	out := make([]byte, 0, len(b))
	for i := 0; i < len(b); i++ {
		if i >= 2 && b[i] == 0x03 && b[i-1] == 0 && b[i-2] == 0 {
			continue
		}
		out = append(out, b[i])
	}
	return out
}

// spsResolution returns the display dimensions coded in an SPS NAL unit.
func spsResolution(sps []byte) (width, height int, ok bool) {
	if len(sps) < 4 {
		return 0, 0, false
	}

	r := &bitReader{data: unescape(sps[1:])} // skip the NAL header byte

	profileIDC := r.bits(8)
	r.bits(8) // constraint flags + reserved
	r.bits(8) // level_idc
	r.ue()    // seq_parameter_set_id

	chromaFormat := uint(1)
	switch profileIDC {
	case 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135:
		chromaFormat = r.ue()
		if chromaFormat == 3 {
			r.bit() // separate_colour_plane_flag
		}
		r.ue()            // bit_depth_luma_minus8
		r.ue()            // bit_depth_chroma_minus8
		r.bit()           // qpprime_y_zero_transform_bypass_flag
		if r.bit() == 1 { // seq_scaling_matrix_present_flag
			lists := 8
			if chromaFormat == 3 {
				lists = 12
			}
			for i := 0; i < lists; i++ {
				if r.bit() == 1 { // seq_scaling_list_present_flag
					size := 16
					if i >= 6 {
						size = 64
					}
					last, next := 8, 8
					for j := 0; j < size; j++ {
						if next != 0 {
							next = (last + r.se() + 256) % 256
						}
						if next != 0 {
							last = next
						}
					}
				}
			}
		}
	}

	r.ue() // log2_max_frame_num_minus4

	switch r.ue() { // pic_order_cnt_type
	case 0:
		r.ue() // log2_max_pic_order_cnt_lsb_minus4
	case 1:
		r.bit() // delta_pic_order_always_zero_flag
		r.se()  // offset_for_non_ref_pic
		r.se()  // offset_for_top_to_bottom_field
		n := r.ue()
		for i := uint(0); i < n && i < 256; i++ {
			r.se()
		}
	}

	r.ue()  // max_num_ref_frames
	r.bit() // gaps_in_frame_num_value_allowed_flag

	widthMBs := int(r.ue()) + 1
	heightMapUnits := int(r.ue()) + 1

	frameMBsOnly := r.bit()
	if frameMBsOnly == 0 {
		r.bit() // mb_adaptive_frame_field_flag
	}
	r.bit() // direct_8x8_inference_flag

	width = widthMBs * 16
	height = (2 - int(frameMBsOnly)) * heightMapUnits * 16

	if r.bit() == 1 { // frame_cropping_flag
		subW, subH := 2, 2
		switch chromaFormat {
		case 0:
			subW, subH = 1, 1
		case 2:
			subH = 1
		case 3:
			subW, subH = 1, 1
		}
		if frameMBsOnly == 0 {
			subH *= 2
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
