// Reads image dimensions from file headers, with no image library: PNG, JPEG, GIF, WebP, SVG,
// AVIF and HEIF, ICO and BMP. Files can be truncated or hostile, so every read is checked
// against the length of the buffer, and anything that does not add up gives null.

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Sizes past this are not real images, and 0 is not an image at all.
const MAX_DIMENSION = 1 << 24;

function startsWith(buffer, bytes, at = 0) {
  if (buffer.length < at + bytes.length) return false;
  return bytes.every((byte, index) => buffer[at + index] === byte);
}

function ascii(buffer, start, end) {
  return end <= buffer.length ? buffer.toString("latin1", start, end) : "";
}

function sized(format, width, height, extra = {}) {
  if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) return null;
  return { format, width, height, ...extra };
}

function readPng(buffer, at = 0) {
  if (buffer.length < at + 24) return null;
  if (ascii(buffer, at + 12, at + 16) !== "IHDR") return null;
  return sized("png", buffer.readUInt32BE(at + 16), buffer.readUInt32BE(at + 20));
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
      return sized("jpeg", buffer.readUInt16BE(i + 5), buffer.readUInt16BE(i + 3));
    }
    // Jumping by length also skips any thumbnail embedded in the metadata segments.
    i += segmentLength;
  }
  return null;
}

// The logical screen, which is the size a browser lays the animation out at.
function readGif(buffer) {
  if (buffer.length < 10) return null;
  return sized("gif", buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}

function readWebp(buffer) {
  if (buffer.length < 30) return null;
  const chunk = ascii(buffer, 12, 16);
  if (chunk === "VP8 ") {
    // A lossy key frame: three bytes of frame tag, the start code, then 14-bit sizes.
    if (!startsWith(buffer, [0x9d, 0x01, 0x2a], 23)) return null;
    return sized("webp", buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === "VP8L") {
    // Lossless: a signature byte, then width and height less one in 14 bits each.
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return sized("webp", (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8X") {
    // Extended: the canvas size less one, in 24 bits each.
    return sized("webp", buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1);
  }
  return null;
}

function readBmp(buffer) {
  if (buffer.length < 26) return null;
  const headerSize = buffer.readUInt32LE(14);
  if (headerSize === 12) return sized("bmp", buffer.readUInt16LE(18), buffer.readUInt16LE(20));
  if (headerSize < 40) return null;
  // A negative height means the rows are stored top down; the image is the same size.
  return sized("bmp", Math.abs(buffer.readInt32LE(18)), Math.abs(buffer.readInt32LE(22)));
}

// An icon file holds several images. The directory gives each one's size in a byte, where 0
// means 256, so a PNG inside is read for its own header, which can say more.
function readIco(buffer) {
  if (buffer.length < 6) return null;
  const count = buffer.readUInt16LE(4);
  if (count === 0 || buffer.length < 6 + count * 16) return null;
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    let width = buffer[entry] || 256;
    let height = buffer[entry + 1] || 256;
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (offset + length > buffer.length || length === 0) return null;
    if (startsWith(buffer, PNG_SIGNATURE, offset)) {
      const inner = readPng(buffer, offset);
      if (!inner) return null;
      ({ width, height } = inner);
    }
    sizes.push({ width, height });
  }
  const largest = sizes.reduce((best, size) => (size.width * size.height > best.width * best.height ? size : best));
  return sized("ico", largest.width, largest.height, { sizes });
}

// ISO base media file boxes, as AVIF and HEIF use. Calls `visit(type, start, end)` for each box
// between `from` and `to`, where start is just past the header. Stops at the first box that
// does not fit, since a truncated file leaves the rest unreadable.
function eachBox(buffer, from, to, visit) {
  let at = from;
  while (at + 8 <= to) {
    let size = buffer.readUInt32BE(at);
    const type = ascii(buffer, at + 4, at + 8);
    let header = 8;
    if (size === 1) {
      if (at + 16 > to) return;
      const high = buffer.readUInt32BE(at + 8);
      if (high !== 0) return;
      size = buffer.readUInt32BE(at + 12);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (size < header || at + size > to) return;
    if (visit(type, at + header, at + size) === false) return;
    at += size;
  }
}

const HEIF_BRANDS = new Set(["avif", "avis", "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1"]);

// The major brand and the compatible brands of the leading ftyp box, or null if there is none.
function fileBrands(buffer) {
  if (buffer.length < 16 || ascii(buffer, 4, 8) !== "ftyp") return null;
  const size = buffer.readUInt32BE(0);
  if (size < 16 || size > buffer.length) return null;
  const brands = [ascii(buffer, 8, 12)];
  for (let at = 16; at + 4 <= size; at += 4) brands.push(ascii(buffer, at, at + 4));
  return brands;
}

// The `ispe` property of the primary item, turned by its `irot` if it has one. Files can hold
// thumbnails and alpha planes with their own sizes, so the item association decides which.
function readHeif(buffer, brands) {
  const format = brands.some((brand) => brand.startsWith("avi")) ? "avif" : "heif";
  let meta = null;
  eachBox(buffer, 0, buffer.length, (type, start, end) => {
    if (type !== "meta") return true;
    meta = { start: start + 4, end };
    return false;
  });
  if (!meta || meta.start > meta.end) return null;
  let primary = null;
  const properties = [];
  const associations = new Map();
  eachBox(buffer, meta.start, meta.end, (type, start, end) => {
    if (type === "pitm" && start + 6 <= end) {
      primary = buffer[start] === 0 ? buffer.readUInt16BE(start + 4) : start + 8 <= end ? buffer.readUInt32BE(start + 4) : null;
    } else if (type === "iprp") {
      eachBox(buffer, start, end, (inner, innerStart, innerEnd) => {
        if (inner === "ipco") {
          eachBox(buffer, innerStart, innerEnd, (property, propertyStart, propertyEnd) => {
            properties.push({ type: property, start: propertyStart, end: propertyEnd });
          });
        } else if (inner === "ipma") {
          readAssociations(buffer, innerStart, innerEnd, associations);
        }
      });
    }
  });
  const ispe = (property) => {
    if (property?.type !== "ispe" || property.start + 12 > property.end) return null;
    return { width: buffer.readUInt32BE(property.start + 4), height: buffer.readUInt32BE(property.start + 8) };
  };
  const linked = primary !== null ? associations.get(primary) ?? [] : [];
  const own = linked.map((index) => properties[index - 1]).filter(Boolean);
  let size = own.map(ispe).find(Boolean) ?? null;
  if (!size) {
    // No usable association: the largest size in the file is the image, not a thumbnail.
    for (const property of properties) {
      const candidate = ispe(property);
      if (candidate && (!size || candidate.width * candidate.height > size.width * size.height)) size = candidate;
    }
    if (!size) return null;
  }
  const rotation = own.find((property) => property.type === "irot" && property.start < property.end);
  const turns = rotation ? buffer[rotation.start] & 3 : 0;
  return turns % 2 === 1 ? sized(format, size.height, size.width) : sized(format, size.width, size.height);
}

// ipma: for each item, the 1-based indexes of its properties in ipco.
function readAssociations(buffer, start, end, associations) {
  if (start + 8 > end) return;
  const version = buffer[start];
  const wideIndexes = (buffer[start + 3] & 1) === 1;
  const count = buffer.readUInt32BE(start + 4);
  let at = start + 8;
  for (let entry = 0; entry < count; entry += 1) {
    const idSize = version < 1 ? 2 : 4;
    if (at + idSize + 1 > end) return;
    const item = idSize === 2 ? buffer.readUInt16BE(at) : buffer.readUInt32BE(at);
    at += idSize;
    const total = buffer[at];
    at += 1;
    const indexes = [];
    for (let k = 0; k < total; k += 1) {
      if (at + (wideIndexes ? 2 : 1) > end) return;
      indexes.push(wideIndexes ? buffer.readUInt16BE(at) & 0x7fff : buffer[at] & 0x7f);
      at += wideIndexes ? 2 : 1;
    }
    associations.set(item, indexes);
  }
}

// Lengths in CSS pixels. Percentages and font-relative units depend on where the image is shown.
const UNITS = { "": 1, px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

function svgLength(value) {
  if (value === null) return null;
  const match = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*([a-z]*)\s*$/i.exec(value);
  if (!match) return null;
  const scale = UNITS[match[2].toLowerCase()];
  return scale === undefined ? null : Number.parseFloat(match[1]) * scale;
}

function svgAttribute(tag, name) {
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of tag.matchAll(pattern)) {
    if (match[1].toLowerCase() === name.toLowerCase()) return match[2] ?? match[3];
  }
  return null;
}

// How far into a file the root <svg> tag may start. Past a prolog this long, it is not an image.
const SVG_SEARCH_BYTES = 64 * 1024;

// The root <svg> element's width and height, or its viewBox where those are missing or
// relative. `vector` marks the result, since such an image has no fixed pixel size.
function readSvg(buffer) {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, SVG_SEARCH_BYTES)).replace(/^\ufeff/, "");
  // Only a prolog may come before the root: a declaration, comments, a doctype and space.
  const prolog = /^(?:\s+|<\?[^]*?\?>|<!--[^]*?-->|<!DOCTYPE[^>[]*(?:\[[^\]]*\])?\s*>)*/i.exec(head)[0];
  if (!/^<svg[\s>/]/i.test(head.slice(prolog.length))) return null;
  const end = head.indexOf(">", prolog.length);
  if (end === -1) return null;
  const tag = head.slice(prolog.length, end);
  let width = svgLength(svgAttribute(tag, "width"));
  let height = svgLength(svgAttribute(tag, "height"));
  const box = (svgAttribute(tag, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  const hasBox = box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0;
  if (hasBox) {
    if (width === null && height === null) [width, height] = [box[2], box[3]];
    else if (width === null) width = (height * box[2]) / box[3];
    else if (height === null) height = (width * box[3]) / box[2];
  }
  if (width === null || height === null) return null;
  return sized("svg", Math.round(width), Math.round(height), { vector: true });
}

// Returns { format, width, height }, or null if this is not an image this can measure. ICO
// results also carry `sizes`, every image in the file, and SVG results carry `vector: true`.
export function readImageSize(buffer) {
  if (startsWith(buffer, PNG_SIGNATURE)) return readPng(buffer);
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return readJpeg(buffer);
  const magic = ascii(buffer, 0, 6);
  if (magic === "GIF87a" || magic === "GIF89a") return readGif(buffer);
  if (ascii(buffer, 0, 4) === "RIFF" && ascii(buffer, 8, 12) === "WEBP") return readWebp(buffer);
  const brands = fileBrands(buffer);
  if (brands?.some((brand) => HEIF_BRANDS.has(brand))) return readHeif(buffer, brands);
  if (ascii(buffer, 0, 2) === "BM") return readBmp(buffer);
  if (startsWith(buffer, [0x00, 0x00, 0x01, 0x00]) || startsWith(buffer, [0x00, 0x00, 0x02, 0x00])) return readIco(buffer);
  return readSvg(buffer);
}
