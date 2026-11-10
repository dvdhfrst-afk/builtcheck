// Builds small image files in memory for tests: only the headers the size readers look at,
// which is all a test of them needs. Sizes are in pixels.

function u16le(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

function u32be(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

export function png(width, height, padding = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13), Buffer.from("IHDR"), header, Buffer.alloc(4),
    Buffer.alloc(padding),
  ]);
}

export function jpeg(width, height, padding = 0) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00];
  return Buffer.concat([Buffer.from([0xff, 0xd8, ...app0, ...sof0]), Buffer.alloc(padding), Buffer.from([0xff, 0xd9])]);
}

export function gif(width, height) {
  return Buffer.concat([Buffer.from("GIF89a"), u16le(width), u16le(height), Buffer.from([0xf0, 0, 0]), Buffer.from(";")]);
}

function riff(chunk, data) {
  const body = Buffer.concat([Buffer.from("WEBP"), Buffer.from(chunk), u32le(data.length), data]);
  return Buffer.concat([Buffer.from("RIFF"), u32le(body.length), body]);
}

export function webpLossy(width, height) {
  const data = Buffer.concat([Buffer.from([0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a]), u16le(width), u16le(height), Buffer.alloc(8)]);
  return riff("VP8 ", data);
}

export function webpLossless(width, height) {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14);
  return riff("VP8L", Buffer.concat([Buffer.from([0x2f]), u32le(bits >>> 0), Buffer.alloc(8)]));
}

export function webpExtended(width, height) {
  const data = Buffer.alloc(10);
  data.writeUIntLE(width - 1, 4, 3);
  data.writeUIntLE(height - 1, 7, 3);
  return riff("VP8X", data);
}

export function bmp(width, height, { core = false } = {}) {
  const header = core ? Buffer.alloc(12) : Buffer.alloc(40);
  header.writeUInt32LE(header.length, 0);
  if (core) {
    header.writeUInt16LE(width, 4);
    header.writeUInt16LE(height, 6);
  } else {
    header.writeInt32LE(width, 4);
    header.writeInt32LE(height, 8);
  }
  return Buffer.concat([Buffer.from("BM"), Buffer.alloc(12), header]);
}

// An icon with one directory entry per image. A size of 256 or more is written as 0, and
// `{ png: true }` stores that image as a PNG, whose own header carries the real size.
export function ico(images) {
  const entries = [];
  const datas = [];
  let offset = 6 + images.length * 16;
  for (const { width, height, png: asPng = false } of images) {
    const data = asPng ? png(width, height) : Buffer.alloc(40);
    const entry = Buffer.alloc(16);
    entry[0] = width >= 256 ? 0 : width;
    entry[1] = height >= 256 ? 0 : height;
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(entry);
    datas.push(data);
  }
  return Buffer.concat([Buffer.from([0, 0, 1, 0]), u16le(images.length), ...entries, ...datas]);
}

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([u32be(body.length + 8), Buffer.from(type, "latin1"), body]);
}

function fullBox(type, version, ...parts) {
  return box(type, Buffer.from([version, 0, 0, 0]), ...parts);
}

// An AVIF or HEIF still image. `items` lists the images inside as { id, width, height }; the
// primary one is `primary`, and `rotate` turns it by that many quarter turns.
export function heif({ brand = "avif", items, primary = items[0].id, rotate = 0, associate = true }) {
  const properties = [];
  const associations = [];
  for (const item of items) {
    properties.push(fullBox("ispe", 0, u32be(item.width), u32be(item.height)));
    const indexes = [properties.length];
    if (item.id === primary && rotate) {
      properties.push(box("irot", Buffer.from([rotate & 3])));
      indexes.push(properties.length);
    }
    associations.push(Buffer.concat([Buffer.from([item.id >> 8, item.id & 0xff, indexes.length]), Buffer.from(indexes)]));
  }
  const ipco = box("ipco", ...properties);
  const ipma = fullBox("ipma", 0, u32be(associations.length), ...associations);
  const meta = fullBox(
    "meta", 0,
    fullBox("hdlr", 0, Buffer.alloc(4), Buffer.from("pict"), Buffer.alloc(13)),
    fullBox("pitm", 0, Buffer.from([primary >> 8, primary & 0xff])),
    box("iprp", ipco, ...(associate ? [ipma] : [])),
  );
  const ftyp = box("ftyp", Buffer.from(brand), u32be(0), Buffer.from("mif1"), Buffer.from(brand === "avif" ? "miaf" : "heic"));
  return Buffer.concat([ftyp, meta, box("mdat", Buffer.alloc(16))]);
}

export function svg(attributes, prolog = "") {
  return Buffer.from(`${prolog}<svg xmlns="http://www.w3.org/2000/svg" ${attributes}><rect width="1" height="1"/></svg>`);
}
