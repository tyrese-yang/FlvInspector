function readUInt8(payload, start) {
    return payload.charCodeAt(start);
}

function readUInt16BE(payload, start) {
    return payload.charCodeAt(start) << 8 | payload.charCodeAt(start + 1)
}

function readUInt32BE(payload, start) {
    return payload.charCodeAt(start) << 24 | payload.charCodeAt(start + 1) << 16 |
        payload.charCodeAt(start + 2) << 8 | payload.charCodeAt(start + 3);
}

function readDoubleBE(payload, start) {
    var buffer = new ArrayBuffer(8);
    var bytes = new Uint8Array(buffer);
    bytes[0] = payload.charCodeAt(start);
    bytes[1] = payload.charCodeAt(start + 1);
    bytes[2] = payload.charCodeAt(start + 2);
    bytes[3] = payload.charCodeAt(start + 3);
    bytes[4] = payload.charCodeAt(start + 4);
    bytes[5] = payload.charCodeAt(start + 5);
    bytes[6] = payload.charCodeAt(start + 6);
    bytes[7] = payload.charCodeAt(start + 7);

    var view = new DataView(buffer);
    return view.getFloat64(0, false);
}

function readInt16BE(payload, start) {
    let v = payload.charCodeAt(start) << 8 | payload.charCodeAt(start + 1);
    if (payload.charCodeAt(start) & 0x80) {
        v = ((~v & 0xFFFF) + 1);
    }
    return v;
}

function parseMetadata(payload) {
    if (readUInt8(payload, 0) !== 2) {
        console.log("not metadata");
        return
    }

    const stringLength = readUInt16BE(payload, 1);
    let parseOffset = 3;
    const metadataName = payload.slice(parseOffset, parseOffset + stringLength);
    console.log(metadataName);
    parseOffset += stringLength;

    const metadataObjType = readUInt8(payload, parseOffset);
    parseOffset++;
    switch (metadataObjType) {
        case 3: {
            break;
        }
        case 8: {
            const metadataLength = readUInt32BE(payload, parseOffset);
            parseOffset += 4;
            break;
        }
        default: {
            console.log("metadata obj type error, type: ", metadataObjType);
        }
    }

    let params = new Map();
    while (true) {
        if (parseOffset >= payload.length - 2) break;
        const paramNameLength = readUInt16BE(payload, parseOffset);
        parseOffset += 2;
        const paramName = payload.slice(parseOffset, parseOffset + paramNameLength);
        parseOffset += paramNameLength;

        const valueType = readUInt8(payload, parseOffset);
        parseOffset++;
        switch (valueType) {
            case 0: {
                params[paramName] = readDoubleBE(payload, parseOffset);
                parseOffset += 8;
                break;
            }
            case 1: {
                params[paramName] = Boolean(readUInt8(payload, parseOffset));
                parseOffset += 1;
                break;
            }
            case 2: {
                let valueLength = readInt16BE(payload, parseOffset);
                parseOffset += 2;
                params[paramName] = payload.slice(parseOffset, parseOffset + valueLength);
                parseOffset += valueLength;
                break;
            }
            default: {
                console.log("unknown metadata value type: " + valueType);
            }
        }
    }
    return params;
}