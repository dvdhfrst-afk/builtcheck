// The language versions a page declares, from its hreflang links or from the sitemap, in one
// shape so both are checked the same way. A set is what one page, or one sitemap <url> entry,
// says about the versions of one page:
//   { subject, subjectUrl, subjectKey, file, offset, entries: [{ value, href, offset, check, target, key }] }
// `subject` is the built file the set describes, `file` where the set is written, and each
// entry's `target` says where its href leads:
//   { kind: "page", file, summary }   a page in this build
//   { kind: "missing" | "redirect" }  this host, but nothing or only a redirect there
//   { kind: "external" }              another host, or a host that is not known
//   { kind: "invalid" }               not a web URL

import { gunzipSync } from "node:zlib";
import { decodeEntities } from "../html/entities.js";
import { isIndexable } from "../site/classify.js";
import { resolveReference } from "../site/urls.js";
import { checkHreflang } from "./language-tags.js";

export function resolveTarget(href, baseUrl, site) {
  const resolved = resolveReference(href, baseUrl, site);
  if (resolved.kind === "fragment") return { kind: "self" };
  if (resolved.kind === "invalid" || resolved.kind === "scheme" || resolved.kind === "empty") return { kind: "invalid" };
  if (resolved.kind !== "internal") return { kind: "external" };
  const found = site.lookup(resolved.path);
  if (found?.file) return { kind: "page", file: found.file, summary: site.page(found.file) };
  if (found?.redirect) return { kind: "redirect", redirect: found.redirect };
  if (found?.external) return { kind: "external" };
  return { kind: "missing", path: resolved.path };
}

// A key that is the same for two hrefs naming the same place.
function targetKey(href, baseUrl, target) {
  if (target.kind === "page") return `file:${target.file}`;
  try {
    return `url:${new URL(href.trim(), baseUrl).href}`;
  } catch {
    return null;
  }
}

// `links` are [{ hreflang, href, offset }]. A fragment-only href names the page itself.
export function buildSet(site, { subject, subjectUrl = null, file, offset = null, baseUrl, links }) {
  const entries = links.map(({ hreflang, href, offset: entryOffset }) => {
    let target = resolveTarget(href, baseUrl, site);
    if (target.kind === "self") target = subject ? { kind: "page", file: subject, summary: site.page(subject) } : { kind: "invalid" };
    return {
      value: hreflang.trim(),
      href: href.trim(),
      offset: entryOffset ?? null,
      check: checkHreflang(hreflang),
      target,
      key: targetKey(href, baseUrl, target),
    };
  });
  const subjectKey = subject ? `file:${subject}` : subjectUrl ? `url:${subjectUrl}` : null;
  return { subject, subjectUrl, subjectKey, file, offset, entries };
}

export function isXDefault(entry) {
  return entry.check.ok && entry.check.xDefault;
}

// The language an entry names, for comparing with a page's lang. A value the built-in lists do
// not know still names its first part, so a language added in the options compares as itself.
export function entryLanguage(entry) {
  if (isXDefault(entry)) return null;
  if (entry.check.ok) return entry.check.language;
  const first = entry.value.split(/[-_]/)[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(first) ? first : null;
}

// True when a set can be checked against the build: every target is known. If the site's own
// host is not known, an absolute URL may well be this site, so nothing is said about it.
export function isSettled(set, site) {
  return site.ownHost !== null || set.entries.every((entry) => entry.target.kind !== "external");
}

// Whether a set names the page it describes. An entry naming the page's canonical URL counts,
// which settles it even when the host is not known.
export function namesItself(set, canonicalUrl = null) {
  return set.entries.some((entry) => entry.key === set.subjectKey || (canonicalUrl !== null && entry.key === `url:${canonicalUrl}`));
}

// Why a target cannot stand as a language version, or null if it can.
export function targetProblem(target) {
  if (target.kind === "missing") return "is not in the build";
  if (target.kind === "redirect") return `only redirects (to ${target.redirect.target})`;
  if (target.kind !== "page" || !target.summary) return null;
  const { summary } = target;
  if (summary.noindex) return "asks not to be indexed";
  if (summary.redirect) return "only redirects";
  if (!isIndexable(summary)) return "is an error page or names a different page as its canonical";
  return null;
}

// ---- Sets from the pages, made once per run

const pageIndexes = new WeakMap();

// Every indexable page's set, from the summaries. Result: Map of file to set.
export function pageSets(site) {
  if (pageIndexes.has(site)) return pageIndexes.get(site);
  const sets = new Map();
  for (const summary of site.pages) {
    if (summary.alternates.length === 0 || !isIndexable(summary)) continue;
    sets.set(summary.file, buildSet(site, { subject: summary.file, file: summary.file, baseUrl: summary.baseUrl, links: summary.alternates }));
  }
  pageIndexes.set(site, sets);
  return sets;
}

// ---- Sets from the sitemap: <xhtml:link rel="alternate" hreflang="..." href="..."/> in <url>

const MAX_SITEMAP_BYTES = 64 * 1024 * 1024;

function readSitemap(site, file) {
  const buffer = site.readBuffer(file, MAX_SITEMAP_BYTES);
  if (buffer === null) return null;
  if (!file.endsWith(".gz")) return buffer.toString("utf8");
  try {
    return gunzipSync(buffer, { maxOutputLength: MAX_SITEMAP_BYTES }).toString("utf8");
  } catch {
    // The foundation rules report a sitemap that cannot be decompressed.
    return null;
  }
}

// Comments blanked to spaces, keeping every offset where it was. Found with indexOf, so an
// unclosed comment costs one scan.
function blankComments(text) {
  let result = "";
  let position = 0;
  for (;;) {
    const start = text.indexOf("<!--", position);
    const end = start === -1 ? -1 : text.indexOf("-->", start + 4);
    if (end === -1) return result + text.slice(position);
    result += text.slice(position, start) + " ".repeat(end + 3 - start);
    position = end + 3;
  }
}

function xmlAttributes(text) {
  const attributes = new Map();
  for (const match of text.matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const name = match[1].toLowerCase();
    if (!attributes.has(name)) attributes.set(name, decodeEntities(match[2] ?? match[3]));
  }
  return attributes;
}

function cdataText(text) {
  return decodeEntities(text.trim().replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim());
}

// The <url> entries of one sitemap that carry alternates: [{ loc, offset, links }]. Names are
// matched on their local part, whatever namespace prefix the file uses.
export function parseSitemapAlternates(source) {
  const text = blankComments(source);
  const entries = [];
  let current = null;
  let locStart = -1;
  const tags = /<(\/?)(?:[\w.-]+:)?(url|loc|link)(?=[\s/>])([^>]{0,2000})>/gi;
  for (const match of text.matchAll(tags)) {
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    if (name === "url") {
      if (!closing) {
        current = { loc: null, offset: match.index, links: [] };
      } else if (current) {
        if (current.loc && current.links.length > 0) entries.push(current);
        current = null;
      }
    } else if (name === "loc" && current) {
      if (!closing) {
        locStart = match.index + match[0].length;
      } else if (locStart !== -1 && current.loc === null) {
        current.loc = cdataText(text.slice(locStart, match.index));
        locStart = -1;
      }
    } else if (name === "link" && current && !closing) {
      const attributes = xmlAttributes(match[3]);
      const rel = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/);
      if (!rel.includes("alternate") || !attributes.has("hreflang") || !attributes.has("href")) continue;
      current.links.push({ hreflang: attributes.get("hreflang"), href: attributes.get("href"), offset: match.index });
    }
  }
  return entries;
}

const sitemapIndexes = new WeakMap();

// Every sitemap <url> entry with alternates, as sets whose `subjectUrl` is the <loc>.
export function sitemapSets(site) {
  if (sitemapIndexes.has(site)) return sitemapIndexes.get(site);
  const sets = [];
  for (const file of site.sitemaps.files) {
    const text = readSitemap(site, file);
    if (text === null || !text.includes("hreflang")) continue;
    for (const entry of parseSitemapAlternates(text)) {
      let subjectUrl;
      try {
        subjectUrl = new URL(entry.loc).href;
      } catch {
        // The foundation rules report a <loc> that is not an absolute URL.
        continue;
      }
      const own = resolveTarget(entry.loc, subjectUrl, site);
      sets.push(buildSet(site, {
        subject: own.kind === "page" ? own.file : null,
        subjectUrl,
        file,
        offset: entry.offset,
        baseUrl: subjectUrl,
        links: entry.links,
      }));
    }
  }
  sitemapIndexes.set(site, sets);
  return sets;
}

// Reports each distinct sitemap problem once, at its first place, with how often it recurs:
// every <url> entry of a group repeats the same links, so one mistake shows up many times.
export function onceEach(report) {
  const seen = new Map();
  return {
    add(key, file, offset, message) {
      const known = seen.get(key);
      if (known) known.count += 1;
      else seen.set(key, { file, offset, message, count: 1 });
    },
    flush() {
      for (const { file, offset, message, count } of seen.values()) {
        report({ file, offset, message: count > 1 ? `${message} (${count} places in the sitemap)` : message });
      }
    },
  };
}
