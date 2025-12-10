
class BitReader {
    constructor(data) {
        this.data = data;
        this.byteOffset = 0;
        this.bitOffset = 0;
    }

    readBit() {
        if (this.byteOffset >= this.data.length) {
            return 0;
        }
        let bit = (this.data[this.byteOffset] >> (7 - this.bitOffset)) & 0x01;
        this.bitOffset++;
        if (this.bitOffset == 8) {
            this.byteOffset++;
            this.bitOffset = 0;
        }
        return bit;
    }

    readBits(n) {
        let res = 0;
        for (let i = 0; i < n; i++) {
            res = (res << 1) | this.readBit();
        }
        return res;
    }

    readUE() {
        let leadingZeros = 0;
        while (this.readBit() === 0 && this.byteOffset < this.data.length) {
            leadingZeros++;
        }
        if (leadingZeros === 0) {
            return 0;
        }
        let res = 1;
        for (let i = 0; i < leadingZeros; i++) {
            res = (res << 1) | this.readBit();
        }
        return res - 1;
    }

    readSE() {
        let value = this.readUE();
        let sign = ((value & 0x01) << 1) - 1;
        return sign * ((value >> 1) + (value & 0x01));
    }

    readBoolean() {
        return this.readBit() === 1;
    }
    
    skipBits(n) {
        this.bitOffset += n;
        while (this.bitOffset >= 8) {
            this.byteOffset++;
            this.bitOffset -= 8;
        }
    }
}

const SPSParser = {
    removeEmulationPrevention: function(data) {
        let newData = new Uint8Array(data.length);
        let offset = 0;
        for (let i = 0; i < data.length; i++) {
            if (i + 2 < data.length && data[i] === 0 && data[i+1] === 0 && data[i+2] === 3) {
                newData[offset++] = data[i];
                newData[offset++] = data[i+1];
                i += 2; // skip 0x03
            } else {
                newData[offset++] = data[i];
            }
        }
        return newData.subarray(0, offset);
    },

    parseH264: function(data) {
        // Skip NAL header (1 byte)
        let rbsp = this.removeEmulationPrevention(data.slice(1));
        let reader = new BitReader(rbsp);
        
        let info = {};
        
        info.profile_idc = reader.readBits(8);
        info.constraint_set_flags = reader.readBits(8); // constraint_set0-5_flag + reserved_zero_2bits
        info.level_idc = reader.readBits(8);
        info.seq_parameter_set_id = reader.readUE();

        if ([100, 110, 122, 244, 44, 83, 86, 118, 128].includes(info.profile_idc)) {
            info.chroma_format_idc = reader.readUE();
            if (info.chroma_format_idc === 3) {
                info.separate_colour_plane_flag = reader.readBoolean();
            }
            info.bit_depth_luma_minus8 = reader.readUE();
            info.bit_depth_chroma_minus8 = reader.readUE();
            info.qpprime_y_zero_transform_bypass_flag = reader.readBoolean();
            info.seq_scaling_matrix_present_flag = reader.readBoolean();
            if (info.seq_scaling_matrix_present_flag) {
                let scalingListCount = (info.chroma_format_idc !== 3) ? 8 : 12;
                for (let i = 0; i < scalingListCount; i++) {
                    let seq_scaling_list_present_flag = reader.readBoolean();
                    if (seq_scaling_list_present_flag) {
                        let sizeOfScalingList = (i < 6) ? 16 : 64;
                        let lastScale = 8;
                        let nextScale = 8;
                        for (let j = 0; j < sizeOfScalingList; j++) {
                            if (nextScale !== 0) {
                                let delta_scale = reader.readSE();
                                nextScale = (lastScale + delta_scale + 256) % 256;
                            }
                            lastScale = (nextScale === 0) ? lastScale : nextScale;
                        }
                    }
                }
            }
        }

        info.log2_max_frame_num_minus4 = reader.readUE();
        info.pic_order_cnt_type = reader.readUE();
        
        if (info.pic_order_cnt_type === 0) {
            info.log2_max_pic_order_cnt_lsb_minus4 = reader.readUE();
        } else if (info.pic_order_cnt_type === 1) {
            info.delta_pic_order_always_zero_flag = reader.readBoolean();
            info.offset_for_non_ref_pic = reader.readSE();
            info.offset_for_top_to_bottom_field = reader.readSE();
            info.num_ref_frames_in_pic_order_cnt_cycle = reader.readUE();
            for (let i = 0; i < info.num_ref_frames_in_pic_order_cnt_cycle; i++) {
                reader.readSE(); // offset_for_ref_frame[i]
            }
        }
        
        info.max_num_ref_frames = reader.readUE();
        info.gaps_in_frame_num_value_allowed_flag = reader.readBoolean();
        
        info.pic_width_in_mbs_minus1 = reader.readUE();
        info.pic_height_in_map_units_minus1 = reader.readUE();
        info.frame_mbs_only_flag = reader.readBoolean();
        
        if (!info.frame_mbs_only_flag) {
            info.mb_adaptive_frame_field_flag = reader.readBoolean();
        }
        
        info.direct_8x8_inference_flag = reader.readBoolean();
        info.frame_cropping_flag = reader.readBoolean();
        
        let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
        if (info.frame_cropping_flag) {
            cropLeft = reader.readUE();
            cropRight = reader.readUE();
            cropTop = reader.readUE();
            cropBottom = reader.readUE();
        }
        info.frame_crop_left_offset = cropLeft;
        info.frame_crop_right_offset = cropRight;
        info.frame_crop_top_offset = cropTop;
        info.frame_crop_bottom_offset = cropBottom;

        // Calculate resolution
        let width = (info.pic_width_in_mbs_minus1 + 1) * 16;
        let height = (2 - (info.frame_mbs_only_flag ? 1 : 0)) * (info.pic_height_in_map_units_minus1 + 1) * 16;
        
        if (info.frame_cropping_flag) {
            let cropUnitX = 1;
            let cropUnitY = 2 - (info.frame_mbs_only_flag ? 1 : 0);
            // Adjust based on chroma format (simplified)
            // Default 4:2:0
            if (!info.chroma_format_idc || info.chroma_format_idc === 1) {
                cropUnitX = 2;
                cropUnitY *= 2;
            }
            
            width -= (cropLeft + cropRight) * cropUnitX;
            height -= (cropTop + cropBottom) * cropUnitY;
        }
        
        info.width = width;
        info.height = height;
        
        return info;
    },

    parseH265: function(data) {
        // Skip NAL header (2 bytes)
        let rbsp = this.removeEmulationPrevention(data.slice(2));
        let reader = new BitReader(rbsp);
        
        let info = {};
        
        info.sps_video_parameter_set_id = reader.readBits(4);
        info.sps_max_sub_layers_minus1 = reader.readBits(3);
        info.sps_temporal_id_nesting_flag = reader.readBoolean();
        
        // Profile Tier Level
        this.parseH265ProfileTierLevel(reader, info.sps_max_sub_layers_minus1);
        
        info.sps_seq_parameter_set_id = reader.readUE();
        info.chroma_format_idc = reader.readUE();
        if (info.chroma_format_idc === 3) {
            info.separate_colour_plane_flag = reader.readBoolean();
        }
        
        info.pic_width_in_luma_samples = reader.readUE();
        info.pic_height_in_luma_samples = reader.readUE();
        
        let conformance_window_flag = reader.readBoolean();
        if (conformance_window_flag) {
            let conf_win_left_offset = reader.readUE();
            let conf_win_right_offset = reader.readUE();
            let conf_win_top_offset = reader.readUE();
            let conf_win_bottom_offset = reader.readUE();
            
            // Adjust resolution based on chroma format
            let subWidthC = (info.chroma_format_idc === 1 || info.chroma_format_idc === 2) ? 2 : 1;
            let subHeightC = (info.chroma_format_idc === 1) ? 2 : 1;
            
            info.width = info.pic_width_in_luma_samples - (conf_win_left_offset + conf_win_right_offset) * subWidthC;
            info.height = info.pic_height_in_luma_samples - (conf_win_top_offset + conf_win_bottom_offset) * subHeightC;
        } else {
            info.width = info.pic_width_in_luma_samples;
            info.height = info.pic_height_in_luma_samples;
        }
        
        return info;
    },

    parseH265ProfileTierLevel: function(reader, maxNumSubLayersMinus1) {
        reader.readBits(2); // general_profile_space
        reader.readBoolean(); // general_tier_flag
        reader.readBits(5); // general_profile_idc
        reader.readBits(32); // general_profile_compatibility_flag
        reader.readBoolean(); // general_progressive_source_flag
        reader.readBoolean(); // general_interlaced_source_flag
        reader.readBoolean(); // general_non_packed_constraint_flag
        reader.readBoolean(); // general_frame_only_constraint_flag
        reader.readBits(44); // general_reserved_zero_44bits
        reader.readBits(8); // general_level_idc
        
        // Sub-layer profile present flags... simplified skipping for now as we just want resolution mainly
        // But to be correct we need to skip correctly.
        let sub_layer_profile_present_flag = [];
        let sub_layer_level_present_flag = [];
        for (let i = 0; i < maxNumSubLayersMinus1; i++) {
            sub_layer_profile_present_flag[i] = reader.readBoolean();
            sub_layer_level_present_flag[i] = reader.readBoolean();
        }
        if (maxNumSubLayersMinus1 > 0) {
            for (let i = maxNumSubLayersMinus1; i < 8; i++) {
                reader.readBits(2); // reserved_zero_2bits
            }
        }
        for (let i = 0; i < maxNumSubLayersMinus1; i++) {
            if (sub_layer_profile_present_flag[i]) {
                reader.readBits(32); // sub_layer_profile_space, tier, idc, compatibility
                reader.readBits(32);
                reader.readBits(24);
            }
            if (sub_layer_level_present_flag[i]) {
                reader.readBits(8);
            }
        }
    }
};
