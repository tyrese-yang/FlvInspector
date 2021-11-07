class FlvTag {
    constructor() {
        this.type = 0;
        this.size = 0;
        this.dts = 0;
        this.pts = 0;
        this.streamId = 0;

        // audio tag header
        this.soundFormat = 0;
        this.soundRate = 0;
        this.soundSize = 0;
        this.soundType = 0;
        // aac packet
        this.aacPacketType = 0;

        // video tag header
        this.frameType = 0;
        this.codecId = 0;
        // avc packet
        this.avcPacketType = 0;
        this.cts = 0;

        this.start = 0;
        this.payload_start = 0;
        this.end = 0;
    }

    getTypeName() {
        switch (this.type) {
            case 8:
                return "Audio";
            case 9:
                return "Video";
            case 18:
                return "Script";
            default:
                return "Unknown";
        }
    }

    getCodecName() {
        if (this.type == 9) {
            switch (this.codecId) {
                case 2:
                    return "H.263";
                case 3:
                    return "Screen Video";
                case 4:
                case 5:
                    return "VP6";
                case 6:
                    return "Screen Video 2"
                case 7:
                    return "H.264"
                case 12:
                    return "H.265"
                default:
                    return "Unknown";
            }
        } else if (this.type == 8) {
            switch (this.soundFormat) {
                case 0:
                    return "PCM";
                case 1:
                    return "ADPCM";
                case 2:
                    return "MP3";
                case 3:
                    return "PCM";
                case 4:
                case 5:
                case 6:
                    return "Nellymoser";
                case 7:
                case 8:
                    return "G.711";
                case 10:
                    return "AAC";
                case 11:
                    return "Speex";
                default:
                    return "Unknown";
            }
        } else {
            return "";
        }
    }

    getSoundRateText() {
        switch (this.soundRate) {
            case 0:
                return "5.5kHz"
            case 1:
                return "11kHz"
            case 2:
                return "22kHz"
            case 3:
                return "44kHz"
            default:
                return "Unknown"
        }
    }

    getSoundSizeText() {
        switch (this.soundSize) {
            case 0:
                return "8-bit"
            case 1:
                return "16-bit"
            default:
                return "Unknown"
        }
    }

    getSoundTypeText() {
        switch (this.soundType) {
            case 0:
                return "Mono"
            case 1:
                return "Stero"
            default:
                return "Unknown"
        }
    }

    getFrameTypeText() {
        switch (this.frameType) {
            case 1:
                return "Key"
            case 2:
                return "Inter"
            default:
                return "Unknown"
        }
    }
}

class FlvParser {
    constructor() {
        // header
        this.version = 0;
        this.haveAudio = 0;
        this.haveVideo = 0;

        this.offset = 0;
        this.length = 0;
        this.tags = [];
        this.parseDone = function () { console.log("done") };
        this.errorMsg = null
    }

    setData(data) {
        this.data = data;
        this.length = data.length
    }

    parseData() {
        // 'F' 'L' 'V'
        if (this.data[0] != 70 || this.data[1] != 76 || this.data[2] != 86) {
            this.errorMsg = "not FLV file"
            this.parseDone();
            return
        }
        this.version = this.data[3];
        this.haveAudio = this.data[4] >>> 2 & 0x01;
        this.haveVideo = this.data[4] & 0x01;
        this.dataOffset = this.data[5] << 24 | this.data[6] << 16 | this.data[7] << 8 | this.data[8]
        if (this.data[8] != 9) {
            this.errorMsg = "parse failed"
            this.parseDone();
            return
        }
        this.offset = 9;
        while (this.offset < this.length) {
            this.offset += 4; // previous tag size
            let tag = new FlvTag;
            tag.start = this.offset;
            tag.type = this.data[this.offset] & 0x1f;
            this.offset++;
            tag.size = this.data[this.offset] << 16 | this.data[this.offset + 1] << 8 | this.data[this.offset + 2];
            this.offset += 3;
            tag.dts = this.data[this.offset + 3] << 24 | this.data[this.offset] << 16 | this.data[this.offset + 1] << 8 | this.data[this.offset + 2];
            tag.pts = tag.dts;
            this.offset += 7; // include StreamID
            tag.payload_start = this.offset;
            if (tag.type == 8) { // audio
                tag.soundFormat = this.data[this.offset] >>> 4 & 0x0f;
                tag.soundRate = this.data[this.offset] >>> 2 & 0x03;
                tag.soundSize = this.data[this.offset] >>> 1 & 0x01;
                tag.soundType = this.data[this.offset] & 0x01;
                tag.payload_start++;
                if (tag.soundFormat == 10) {
                    tag.aacPacketType = this.data[this.offset + 1];
                    tag.payload_start++;
                }
            } else if (tag.type == 9) { // video
                tag.frameType = this.data[this.offset] >>> 4 & 0x0f;
                tag.codecId = this.data[this.offset] & 0x0f;
                tag.payload_start++;
                if (tag.codecId == 7) {
                    tag.avcPacketType = this.data[this.offset + 1];
                    tag.payload_start++;
                    if (tag.avcPacketType == 1) {
                        tag.cts = this.data[this.offset + 2] << 16 | this.data[this.offset + 3] << 8 | this.data[this.offset + 4];
                        if (this.data[this.offset + 2] & 0x80) {// negative
                            tag.cts = -((~tag.cts & 0xFFFFFF) + 1);
                        }
                        tag.pts += tag.cts;
                        tag.payload_start += 3;
                    }
                }
            }
            this.offset += tag.size;
            tag.end = this.offset;
            // console.log(tag);
            this.tags.push(tag);
        }
        this.parseDone();
    }
}