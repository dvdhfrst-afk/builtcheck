// Finds and reads the RSS and Atom feeds in a build.

import { getAttr } from "../html/tree.js";
import { baseUrlForFile } from "../site/urls.js";
import { childElements, firstChild, parseXml, prologEnd } from "./xml.js";

export const ATOM = "http://www.w3.org/2005/Atom";

// Where generators put a site's main feed. Astro, Gatsby and Eleventy, Jekyll, Hugo, WordPress.
export const COMMON_FEED_PATHS = [
  "rss.xml", "feed.xml", "atom.xml", "index.xml", "feed.rss", "feed.atom",
  "feed/index.xml", "rss/index.xml", "blog/rss.xml", "blog/feed.xml", "blog/atom.xml", "blog/index.xml",
];

const FEED_TYPES = new Set(["application/rss+xml", "application/atom+xml"]);

// Whether a <link> announces an RSS or Atom feed.
export function isFeedLink(element, rels) {
  const type = (getAttr(element, "type") ?? "").split(";")[0].trim().toLowerCase();
  return rels.includes("alternate") && FEED_TYPES.has(type);
}

// Whether a file found at a common path is meant as a feed: its root element is named like one.
// Only then does a file nobody links get checked, so an unrelated index.xml stays out of it.
function looksLikeFeed(text) {
  const start = prologEnd(text);
  return /^<(?:[\w.-]+:)?(?:rss|feed)[\s>/]/.test(text.slice(start, start + 64));
}

const feeds = new WeakMap();

// Reads a feed once per run. Result:
//   { file, url, error, kind, root, container, items, looksLikeFeed }
// where `kind` is "rss", "atom", or null for XML that is neither (RSS 1.0 among them), `error`
// is { message, offset } when it is not well formed, `container` is the RSS channel or the Atom
// feed element, and `items` its items or entries. Null if the file could not be read.
export function readFeed(site, file) {
  if (!feeds.has(site)) feeds.set(site, new Map());
  const cache = feeds.get(site);
  if (cache.has(file)) return cache.get(file);
  const text = site.readText(file);
  let feed = null;
  if (text !== null) {
    const { root, error } = parseXml(text);
    feed = { file, url: baseUrlForFile(file, site), error, kind: null, root, container: null, items: [], looksLikeFeed: looksLikeFeed(text) };
    if (root?.local === "rss" && root.ns === null) {
      feed.kind = "rss";
      feed.container = firstChild(root, "channel", null);
      feed.items = feed.container ? childElements(feed.container, "item", null) : [];
    } else if (root?.local === "feed" && root.ns === ATOM) {
      feed.kind = "atom";
      feed.container = root;
      feed.items = childElements(root, "entry", ATOM);
    }
  }
  cache.set(file, feed);
  return feed;
}

// The text of a child element, trimmed, or null if there is no such child.
export function childText(element, local, ns) {
  const child = firstChild(element, local, ns);
  return child ? child.text.trim() : null;
}

// Atom <link> elements of a relation. A link with no rel is an alternate link.
export function atomLinks(element, rel) {
  return childElements(element, "link", ATOM).filter((link) => (link.attrs.get("rel") ?? "alternate").trim().toLowerCase() === rel);
}
