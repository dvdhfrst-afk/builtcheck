// Finds and reads the XML sitemaps in a build, following sitemap index files.

import { gunzipSync } from "node:zlib";
import { decodeEntities } from "../html/entities.js";

const LOC = /<loc\b[^>]*>\s*(?:<!\[CDATA\[)?([^]*?)(?:\]\]>)?\s*<\/loc\s*>/gi;

function blankXmlComments(text) {
  return text.replace(/<!--[^]*?-->/g, (match) => match.replace(/[^\n]/g, " "));
}

// Returns { kind: "urlset" | "index", locs: [{ url, offset }] }, or null if neither root exists.
export function parseSitemapXml(text) {
  const xml = blankXmlComments(text);
  const kind = /<sitemapindex[\s>]/i.test(xml) ? "index" : /<urlset[\s>]/i.test(xml) ? "urlset" : null;
  if (!kind) return null;
  const locs = [];
  for (const match of xml.matchAll(LOC)) {
    locs.push({ url: decodeEntities(match[1].trim()), offset: match.index });
  }
  return { kind, locs };
}

function readSitemapText(site, file) {
  const buffer = site.readBuffer(file);
  if (!file.endsWith(".gz")) return buffer.toString("utf8");
  try {
    return gunzipSync(buffer).toString("utf8");
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
  return { files, entries, problems };
}
