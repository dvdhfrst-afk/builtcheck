// What the asset rules need to know about files in the build: their size on disk, their image
// dimensions and a hash of their content. Each is worked out once per run and file, however
// many pages refer to it.

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { join } from "node:path";

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif|heic|heif|svg|ico|bmp|tiff?|jxl)$/i;
const STYLESHEET_FILE = /\.css$/i;
const SCRIPT_FILE = /\.(?:m|c)?js$/i;
const FONT_FILE = /\.(?:woff2?|ttf|otf|eot)$/i;
const MEDIA_FILE = /\.(?:mp4|webm|ogv|mov|mp3|ogg|oga|wav|flac|m4a)$/i;
const DOCUMENT_FILE = /\.(?:pdf|zip)$/i;

// Hashing and measuring read the whole file, so past these sizes a file is left out. Asking
// the site to read a larger one would record it as skipped and the run as incomplete.
const MAX_HASHED_BYTES = 256 * 1024 * 1024;
const MAX_MEASURED_BYTES = 64 * 1024 * 1024;

const caches = new WeakMap();

function cacheFor(site) {
  if (!caches.has(site)) caches.set(site, { bytes: new Map(), images: new Map(), hashes: new Map() });
  return caches.get(site);
}

export function isImageFile(file) {
  return IMAGE_FILE.test(file);
}

export function isStylesheetFile(file) {
  return STYLESHEET_FILE.test(file);
}

export function isScriptFile(file) {
  return SCRIPT_FILE.test(file);
}

// Files a page loads or links to as a resource, as opposed to pages, feeds and text files.
export function isAssetFile(file) {
  return IMAGE_FILE.test(file) || STYLESHEET_FILE.test(file) || SCRIPT_FILE.test(file) || FONT_FILE.test(file) || MEDIA_FILE.test(file) || DOCUMENT_FILE.test(file);
}

// The size of a built file in bytes, or null if it is not in the build or could not be read. A
// link to a file outside the site folder is never opened, so it has no size here either.
export function fileBytes(site, file) {
  const { bytes } = cacheFor(site);
  if (!bytes.has(file)) {
    let size = null;
    if (site.hasFile(file) && !site.outsideFiles.has(file)) {
      try {
        size = statSync(join(site.root, file)).size;
      } catch {
        size = null;
      }
    }
    bytes.set(file, size);
  }
  return bytes.get(file);
}

// { format, width, height, ... } as readImageSize gives it, or null if it cannot be measured.
export function imageInfo(site, file) {
  const { images } = cacheFor(site);
  if (!images.has(file)) {
    const size = fileBytes(site, file);
    images.set(file, size !== null && size <= MAX_MEASURED_BYTES ? site.imageSize(file) ?? null : null);
  }
  return images.get(file);
}

export function contentHash(site, file) {
  const { hashes } = cacheFor(site);
  if (!hashes.has(file)) {
    const size = fileBytes(site, file);
    const buffer = size !== null && size <= MAX_HASHED_BYTES ? site.readBuffer(file, MAX_HASHED_BYTES) : null;
    hashes.set(file, buffer === null ? null : createHash("sha256").update(buffer).digest("hex"));
  }
  return hashes.get(file);
}

// "740 KB" or "3.4 MB", where a kilobyte is 1,024 bytes as budgets here count them.
export function formatBytes(bytes) {
  const kilobytes = bytes / 1024;
  if (kilobytes < 1024) return `${Math.max(1, Math.round(kilobytes))} KB`;
  return `${(kilobytes / 1024).toFixed(1)} MB`;
}
