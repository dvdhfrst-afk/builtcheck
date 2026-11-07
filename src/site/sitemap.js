// Finds and reads the XML sitemaps in a build, following sitemap index files.

import { gunzipSync } from "node:zlib";
import { decodeEntities } from "../html/entities.js";

function blankXmlComments(text) {
  let result = "";
  let position = 0;
  for (;;) {
    const start = text.indexOf("<!--", position);
    const end = start === -1 ? -1 : text.indexOf("-->", start + 4);
    if (end === -1) return result + text.slice(position);
    result += text.slice(position, start) + text.slice(start, end + 3).replace(/[^\n]/g, " ");
    position = end + 3;
  }
}

// Returns { kind: "urlset" | "index", locs: [{ url, offset }] }, or null if neither root exists.
export function parseSitemapXml(text) {
  const xml = blankXmlComments(text);
  const root = /<(?:([\w.-]+):)?(sitemapindex|urlset)[\s>]/i.exec(xml);
  if (!root) return null;
  const kind = root[2].toLowerCase() === "urlset" ? "urlset" : "index";
  // Only the sitemap's own <loc>: an image:loc inside a URL entry is something else.
  const name = root[1] ? `${root[1]}:loc` : "loc";
  const open = new RegExp(`<${name}(?=[\\s>])[^>]{0,200}>`, "gi");
  const close = new RegExp(`</${name}\\s*>`, "gi");
  const locs = [];
  for (let match = open.exec(xml); match; match = open.exec(xml)) {
    close.lastIndex = open.lastIndex;
    const end = close.exec(xml);
    if (!end) break;
    const value = xml.slice(open.lastIndex, end.index).trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
    locs.push({ url: decodeEntities(value.trim()), offset: match.index });
    open.lastIndex = close.lastIndex;
  }
  return { kind, locs };
}

// The sitemap format allows 50 MB per file. Anything past this is not a sitemap.
const MAX_SITEMAP_BYTES = 64 * 1024 * 1024;

function readSitemapText(site, file) {
  const buffer = site.readBuffer(file, MAX_SITEMAP_BYTES);
  if (buffer === null) return undefined;
  if (!file.endsWith(".gz")) return buffer.toString("utf8");
  try {
    return gunzipSync(buffer, { maxOutputLength: MAX_SITEMAP_BYTES }).toString("utf8");
  } catch {
    return null;
  }
}

export function fileForSitemapUrl(site, url) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url, "http://builtcheck.invalid/").pathname);
  } catch {
    return null;
  }
  const relative = pathname.replace(/^\/+/, "");
  if (site.hasFile(relative)) return relative;
  // A site under a base path still keeps its sitemap files at the root of the build.
  const base = relative.split("/").pop();
  return site.hasFile(base) ? base : null;
}

// Reads every reachable sitemap. Result: { files, entries, problems }, where
// entries are [{ url, file, offset }] and problems are [{ file, offset, message }].
export function loadSitemaps(site, candidates, robots) {
  const queue = [];
  for (const declared of robots ? robots.sitemaps : []) {
    const file = fileForSitemapUrl(site, declared.url);
    if (file) queue.push(file);
  }
  if (queue.length === 0) {
    queue.push(...candidates.filter((candidate) => site.hasFile(candidate)));
  }
  const files = [];
  const entries = [];
  const problems = [];
  const seen = new Set();
  while (queue.length > 0) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    files.push(file);
    const text = readSitemapText(site, file);
    if (text === undefined) continue;
    if (text === null) {
      problems.push({ file, offset: null, message: `${file} could not be decompressed` });
      continue;
    }
    const parsed = parseSitemapXml(text);
    if (!parsed) {
      problems.push({ file, offset: null, message: `${file} has no <urlset> or <sitemapindex> root element` });
      continue;
    }
    if (parsed.locs.length === 0) {
      problems.push({ file, offset: null, message: `${file} lists no URLs` });
      continue;
    }
    for (const { url, offset } of parsed.locs) {
      if (parsed.kind === "index") {
        const child = fileForSitemapUrl(site, url);
        if (child) queue.push(child);
        else problems.push({ file, offset, message: `Sitemap index names ${url}, which is not in the build` });
      } else if (!/^https?:\/\//i.test(url)) {
        problems.push({ file, offset, message: `Sitemap URL "${url}" is not an absolute http or https URL` });
      } else {
        entries.push({ url, file, offset });
      }
    }
  }
  // An index that only ever leads back to itself lists nothing, just as an empty <urlset> does.
  if (files.length > 0 && entries.length === 0 && problems.length === 0) {
    problems.push({ file: files[0], offset: null, message: `${files[0]} lists no URLs` });
  }
  return { files, entries, problems };
}
