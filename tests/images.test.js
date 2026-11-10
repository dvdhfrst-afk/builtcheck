// Image size reading from file headers, for every format, and its behavior on truncated and
// hostile files.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readImageSize } from "../src/site/images.js";
import { findingsFor, page } from "./helpers.js";
import { bmp, gif, heif, ico, jpeg, png, svg, webpExtended, webpLossless, webpLossy } from "./image-bytes.js";

const size = (buffer) => {
  const result = readImageSize(buffer);
  return result && { format: result.format, width: result.width, height: result.height };
};

test("reads PNG and JPEG sizes as before", () => {
  assert.deepEqual(size(png(1200, 630)), { format: "png", width: 1200, height: 630 });
  assert.deepEqual(size(jpeg(800, 600)), { format: "jpeg", width: 800, height: 600 });
});

test("reads GIF sizes from the logical screen", () => {
  assert.deepEqual(size(gif(320, 240)), { format: "gif", width: 320, height: 240 });
  const old = gif(16, 8);
  old.write("GIF87a", 0, "latin1");
  assert.deepEqual(size(old), { format: "gif", width: 16, height: 8 });
});

test("reads lossy, lossless and extended WebP", () => {
  assert.deepEqual(size(webpLossy(1024, 768)), { format: "webp", width: 1024, height: 768 });
  assert.deepEqual(size(webpLossless(1, 16384)), { format: "webp", width: 1, height: 16384 });
  assert.deepEqual(size(webpLossless(4000, 3000)), { format: "webp", width: 4000, height: 3000 });
  assert.deepEqual(size(webpExtended(16777216, 2)), { format: "webp", width: 16777216, height: 2 });
});

test("a lossy WebP without the key frame start code is not read", () => {
  const broken = webpLossy(10, 10);
  broken[23] = 0;
  assert.equal(readImageSize(broken), null);
});

test("reads BMP sizes from both header kinds, and top-down bitmaps", () => {
  assert.deepEqual(size(bmp(640, 480)), { format: "bmp", width: 640, height: 480 });
  assert.deepEqual(size(bmp(640, -480)), { format: "bmp", width: 640, height: 480 });
  assert.deepEqual(size(bmp(64, 32, { core: true })), { format: "bmp", width: 64, height: 32 });
});

test("reads every size in an icon file, with 0 meaning 256 and PNG entries read for their own header", () => {
  const result = readImageSize(ico([{ width: 16, height: 16 }, { width: 32, height: 32 }, { width: 256, height: 256 }]));
  assert.equal(result.format, "ico");
  assert.deepEqual(result.sizes, [{ width: 16, height: 16 }, { width: 32, height: 32 }, { width: 256, height: 256 }]);
  assert.deepEqual([result.width, result.height], [256, 256]);
  const large = readImageSize(ico([{ width: 48, height: 48 }, { width: 512, height: 512, png: true }]));
  assert.deepEqual(large.sizes, [{ width: 48, height: 48 }, { width: 512, height: 512 }]);
  assert.deepEqual([large.width, large.height], [512, 512]);
});

test("an icon whose entries point past the end of the file is not read", () => {
  const icon = ico([{ width: 16, height: 16 }]);
  icon.writeUInt32LE(icon.length, 6 + 12);
  assert.equal(readImageSize(icon), null);
  const empty = Buffer.from([0, 0, 1, 0, 0, 0]);
  assert.equal(readImageSize(empty), null);
});

test("reads AVIF and HEIF sizes from the primary item, not a thumbnail", () => {
  const avif = readImageSize(heif({ items: [{ id: 1, width: 1920, height: 1080 }, { id: 2, width: 320, height: 180 }] }));
  assert.deepEqual({ format: avif.format, width: avif.width, height: avif.height }, { format: "avif", width: 1920, height: 1080 });
  const thumbnailFirst = heif({ items: [{ id: 2, width: 160, height: 90 }, { id: 1, width: 4000, height: 2250 }], primary: 1 });
  assert.deepEqual(size(thumbnailFirst), { format: "avif", width: 4000, height: 2250 });
  assert.deepEqual(size(heif({ brand: "heic", items: [{ id: 1, width: 3024, height: 4032 }] })), { format: "heif", width: 3024, height: 4032 });
});

test("an AVIF turned a quarter turn reports its displayed size", () => {
  assert.deepEqual(size(heif({ items: [{ id: 1, width: 1600, height: 900 }], rotate: 1 })), { format: "avif", width: 900, height: 1600 });
  assert.deepEqual(size(heif({ items: [{ id: 1, width: 1600, height: 900 }], rotate: 2 })), { format: "avif", width: 1600, height: 900 });
});

test("an AVIF without item associations falls back to its largest size", () => {
  const buffer = heif({ items: [{ id: 1, width: 64, height: 64 }, { id: 2, width: 2048, height: 1024 }], associate: false });
  assert.deepEqual(size(buffer), { format: "avif", width: 2048, height: 1024 });
});

test("an ISO media file of another kind, such as an MP4 video, is not read as an image", () => {
  const mp4 = heif({ brand: "isom", items: [{ id: 1, width: 10, height: 10 }] });
  mp4.write("isom", 8, "latin1");
  mp4.write("iso2", 16, "latin1");
  mp4.write("mp41", 20, "latin1");
  assert.equal(readImageSize(mp4), null);
});

test("reads SVG width and height in pixels and absolute units", () => {
  assert.deepEqual(size(svg('width="120" height="40"')), { format: "svg", width: 120, height: 40 });
  assert.deepEqual(size(svg('width="64px" height="32px"')), { format: "svg", width: 64, height: 32 });
  assert.deepEqual(size(svg("width='1in' height='72pt'")), { format: "svg", width: 96, height: 96 });
  assert.equal(readImageSize(svg('width="10" height="10"')).vector, true);
});

test("falls back to the viewBox when SVG sizes are missing or relative", () => {
  assert.deepEqual(size(svg('viewBox="0 0 300 150"')), { format: "svg", width: 300, height: 150 });
  assert.deepEqual(size(svg('width="100%" height="100%" viewBox="0,0,48,24"')), { format: "svg", width: 48, height: 24 });
  assert.deepEqual(size(svg('width="600" viewBox="0 0 300 150"')), { format: "svg", width: 600, height: 300 });
  assert.deepEqual(size(svg('height="2em" viewBox="0 0 300 150"')), { format: "svg", width: 300, height: 150 });
});

test("reads an SVG after an XML declaration, comments, a doctype and a byte order mark", () => {
  const prolog = '\ufeff<?xml version="1.0"?>\n<!-- made by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n';
  assert.deepEqual(size(svg('viewBox="0 0 24 24"', prolog)), { format: "svg", width: 24, height: 24 });
});

test("an SVG with no usable size, or an HTML or text file, is not measured", () => {
  assert.equal(readImageSize(svg('width="50%"')), null);
  assert.equal(readImageSize(svg('viewBox="0 0 0 10"')), null);
  assert.equal(readImageSize(Buffer.from("<!doctype html><html><svg viewBox='0 0 1 1'></svg></html>")), null);
  assert.equal(readImageSize(Buffer.from("plain text, not an image")), null);
  assert.equal(readImageSize(Buffer.alloc(0)), null);
});

test("zero and absurd dimensions are not sizes", () => {
  assert.equal(readImageSize(png(0, 10)), null);
  assert.equal(readImageSize(gif(10, 0)), null);
  assert.equal(readImageSize(png(0x7fffffff, 1)), null);
});

const SAMPLES = {
  png: png(40, 30),
  jpeg: jpeg(40, 30),
  gif: gif(40, 30),
  "webp lossy": webpLossy(40, 30),
  "webp lossless": webpLossless(40, 30),
  "webp extended": webpExtended(40, 30),
  bmp: bmp(40, 30),
  ico: ico([{ width: 16, height: 16 }, { width: 300, height: 300, png: true }]),
  avif: heif({ items: [{ id: 1, width: 40, height: 30 }, { id: 2, width: 4, height: 3 }], rotate: 1 }),
  svg: svg('viewBox="0 0 40 30"'),
};

test("every truncation of every format gives null or a size, and never throws", () => {
  for (const [name, buffer] of Object.entries(SAMPLES)) {
    for (let length = 0; length < buffer.length; length += 1) {
      let result;
      assert.doesNotThrow(() => {
        result = readImageSize(buffer.subarray(0, length));
      }, `${name} cut to ${length} bytes`);
      if (result !== null) assert.ok(result.width > 0 && result.height > 0, `${name} cut to ${length} bytes`);
    }
  }
});

test("random bytes after every format's signature never throw", () => {
  // A fixed generator, so a failure can be repeated.
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed & 0xff;
  };
  for (const [name, sample] of Object.entries(SAMPLES)) {
    for (let round = 0; round < 200; round += 1) {
      const buffer = Buffer.from(sample);
      for (let i = 4 + (round % 12); i < buffer.length; i += 1 + (round % 3)) buffer[i] = random();
      assert.doesNotThrow(() => readImageSize(buffer), `${name}, round ${round}`);
    }
  }
});

test("boxes and icon directories that claim huge sizes are bounded", () => {
  const icon = Buffer.from([0, 0, 1, 0, 0xff, 0xff]);
  assert.equal(readImageSize(icon), null);
  const avif = heif({ items: [{ id: 1, width: 40, height: 30 }] });
  // The meta box claims to run far past the end of the file.
  const metaAt = avif.readUInt32BE(0);
  avif.writeUInt32BE(0x7fffffff, metaAt);
  assert.equal(readImageSize(avif), null);
  const hugeCount = heif({ items: [{ id: 1, width: 40, height: 30 }] });
  const ipma = hugeCount.indexOf("ipma", 0, "latin1");
  hugeCount.writeUInt32BE(0xffffffff, ipma + 8);
  assert.doesNotThrow(() => readImageSize(hugeCount));
});

test("a long SVG prolog of unclosed comments finishes quickly", () => {
  const hostile = Buffer.from(`${"<!--".repeat(20000)}<svg viewBox="0 0 1 1"></svg>`);
  const started = Date.now();
  readImageSize(hostile);
  assert.ok(Date.now() - started < 1000);
});

test("social image rules now measure WebP and other formats", () => {
  const head = '<meta property="og:image" content="/og-default.webp">';
  const files = { "og-default.webp": webpLossy(1200, 600), "index.html": page("x", head) };
  const config = { site: { socialImagePaths: ["og-default.webp"] } };
  const findings = findingsFor(files, "foundation/social-image-size", config);
  assert.deepEqual(findings.map((finding) => finding.message), ["Default social image is 1200x600, expected 1200x630"]);
  const good = { "og-default.webp": webpLossy(1200, 630), "index.html": page("x", head) };
  assert.deepEqual(findingsFor(good, "foundation/social-image-size", config), []);
});
