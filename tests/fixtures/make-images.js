// Writes the small binary images the fixture sites need. Run from the repository
// root with `node tests/fixtures/make-images.js`. The output is committed, so this
// only matters when a fixture image has to change.
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([length, typeBytes, data, crc]);
}

function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // one bit per pixel keeps the file small
  header[9] = 0; // grayscale
  const row = Buffer.alloc(1 + Math.ceil(width / 8), 0x55);
  row[0] = 0;
  const pixels = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y += 1) row.copy(pixels, y * row.length);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Only the headers matter here: start of image, a JFIF segment, a frame header, end of image.
function jpeg(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof0, 0xff, 0xd9]);
}

const base = "tests/fixtures";
writeFileSync(`${base}/clean-site/site/og-default.png`, png(1200, 630));
writeFileSync(`${base}/bad-foundation/site/og-default.jpg`, jpeg(1200, 627));
writeFileSync(`${base}/bad-foundation/site/img/wide.png`, png(1200, 675));
