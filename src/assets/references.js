// The files a page loads as it renders, and what kind each one is. The link rules ask whether
// these exist; the asset rules ask how much they weigh and how they are fetched.

import { findUrls } from "../css/scanner.js";
import { getAttr } from "../html/tree.js";
import { parseSrcset } from "../rules/links.js";
import { baseUrlForFile } from "../site/urls.js";

export function linkRels(element) {
  return (getAttr(element, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

const inertRanges = new WeakMap();

// The outermost template and noscript elements of a page, in source order, found once per page.
// Elements nest, so a range either holds the next one or ends before it starts.
function rangesFor(page) {
  if (!inertRanges.has(page)) {
    const ranges = [];
    const elements = [...page.all("template"), ...page.all("noscript")].sort((a, b) => a.start - b.start);
    for (const { start, end } of elements) {
      if (ranges.length === 0 || start >= ranges[ranges.length - 1].end) ranges.push({ start, end });
    }
    inertRanges.set(page, ranges);
  }
  return inertRanges.get(page);
}

// Whether an element sits where a browser does not load it: a template, or the fallback that a
// browser running scripts never shows. A search over ranges rather than a walk up the tree, so a
// page of deeply nested elements costs no more than a flat one.
export function isInert(page, element) {
  const ranges = rangesFor(page);
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle].start < element.start) low = middle + 1;
    else high = middle;
  }
  const range = ranges[low - 1];
  return range !== undefined && element.start < range.end;
}

// Whether an element is in the document's head, which ends where the body starts.
export function isInHead(page, element) {
  const head = page.first("head");
  return head !== null && element.start > head.start && element.start < head.end;
}

const LINK_KINDS = [
  ["stylesheet", "stylesheet"],
  ["icon", "image"], ["apple-touch-icon", "image"], ["apple-touch-icon-precomposed", "image"], ["mask-icon", "image"],
  ["modulepreload", "script"], ["manifest", "manifest"],
];

const PRELOAD_KINDS = { style: "stylesheet", script: "script", font: "font", image: "image" };

function linkKind(element) {
  const rels = linkRels(element);
  if (rels.includes("alternate") && rels.includes("stylesheet")) return null;
  if (rels.includes("preload")) return PRELOAD_KINDS[(getAttr(element, "as") ?? "").trim().toLowerCase()] ?? "other";
  for (const [rel, kind] of LINK_KINDS) if (rels.includes(rel)) return kind;
  return null;
}

// Every subresource reference on a page: [{ element, url, kind, candidate }]. `kind` is one of
// stylesheet, script, image, font, media, frame, manifest or other. `candidate` marks one of
// several srcset choices, of which a browser fetches only one.
export function pageSubresources(page) {
  const found = [];
  const add = (element, url, kind, candidate = false) => {
    if (url !== null && url.trim() !== "") found.push({ element, url, kind, candidate });
  };
  for (const element of page.elements) {
    if (isInert(page, element)) continue;
    switch (element.name) {
      case "link": {
        const kind = linkKind(element);
        if (kind) add(element, getAttr(element, "href"), kind);
        for (const url of parseSrcset(getAttr(element, "imagesrcset") ?? "")) add(element, url, "image", true);
        break;
      }
      case "script":
        add(element, getAttr(element, "src"), "script");
        break;
      case "img":
        add(element, getAttr(element, "src"), "image");
        for (const url of parseSrcset(getAttr(element, "srcset") ?? "")) add(element, url, "image", true);
        break;
      case "source": {
        const media = element.parent?.name === "audio" || element.parent?.name === "video";
        add(element, getAttr(element, "src"), media ? "media" : "image");
        for (const url of parseSrcset(getAttr(element, "srcset") ?? "")) add(element, url, "image", true);
        break;
      }
      case "input":
        if ((getAttr(element, "type") ?? "").trim().toLowerCase() === "image") add(element, getAttr(element, "src"), "image");
        break;
      case "video":
        add(element, getAttr(element, "src"), "media");
        add(element, getAttr(element, "poster"), "image");
        break;
      case "audio":
      case "track":
        add(element, getAttr(element, "src"), "media");
        break;
      case "iframe":
      case "embed":
        add(element, getAttr(element, "src"), "frame");
        break;
      case "object":
        add(element, getAttr(element, "data"), "frame");
        break;
      default:
        break;
    }
  }
  return found;
}

// The URL a stylesheet's relative references resolve against.
export function stylesheetBaseUrl(source, site) {
  return source.page ? source.page.baseUrl : baseUrlForFile(source.file, site);
}

// Whether a declaration sits directly in an @font-face block.
export function isFontFaceDeclaration(declaration) {
  const inner = declaration.atRules[declaration.atRules.length - 1];
  return declaration.selector === "" && inner !== undefined && /^@font-face\b/i.test(inner);
}

// The font a browser downloads for each @font-face in a stylesheet: the first `src` entry that
// is a url(), since it stops at the first format it supports. Returns [{ url, offset }].
export function fontFaceUrls(source) {
  const found = [];
  for (const declaration of source.declarations) {
    if (declaration.property !== "src" || !isFontFaceDeclaration(declaration)) continue;
    const first = findUrls(declaration.value).find(({ url }) => !/^data:/i.test(url.trim()));
    if (first) found.push({ url: first.url, offset: declaration.valueOffset + first.index });
  }
  return found;
}
