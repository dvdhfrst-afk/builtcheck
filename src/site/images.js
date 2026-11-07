// Reads image dimensions from PNG and JPEG headers, with no image library.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readPng(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  return { format: "png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function isStartOfFrame(marker) {
  // C0 to CF are frame headers, except C4 (Huffman tables), C8 (reserved) and CC (arithmetic).
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readJpeg(buffer) {
  let i = 2;
  while (i + 1 < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    let marker = buffer[i + 1];
    // Any number of 0xFF fill bytes may come before a marker.
    while (marker === 0xff && i + 2 < buffer.length) {
      i += 1;
      marker = buffer[i + 1];
    }
    i += 2;
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (i + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(i);
    if (segmentLength < 2) return null;
    if (isStartOfFrame(marker)) {
      if (i + 7 > buffer.length) return null;
      return { format: "jpeg", height: buffer.readUInt16BE(i + 3), width: buffer.readUInt16BE(i + 5) };
    }
    // Jumping by length also skips any thumbnail embedded in the metadata segments.
    i += segmentLength;
  }
  return null;
}

// Returns { format, width, height }, or null if this is not a readable PNG or JPEG.
export function readImageSize(buffer) {
  if (buffer.length >= 8 && PNG_SIGNATURE.every((byte, index) => buffer[index] === byte)) {
    return readPng(buffer);
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return readJpeg(buffer);
  }
  return null;
}
