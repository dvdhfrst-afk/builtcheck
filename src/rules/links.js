// Rules about internal links, in-page anchors, referenced assets and links that go nowhere.

import { findUrls, importTarget } from "../css/scanner.js";
import { getAttr, textContent } from "../html/tree.js";
import { baseUrlForFile, meaningfulFragment, resolveReference } from "../site/urls.js";

const NAVIGATION_RELS = new Set(["canonical", "alternate", "next", "prev"]);
const ASSET_RELS = new Set([
  "stylesheet", "icon", "shortcut", "apple-touch-icon", "apple-touch-icon-precomposed",
  "mask-icon", "manifest", "preload", "modulepreload", "prefetch",
]);

function linkRels(element) {
  return (getAttr(element, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function describeMissing(reference, resolved, site) {
  const actual = site.caseMismatch(resolved.path);
  if (actual) return `${reference} differs only in letter case from ${actual}, which breaks on case-sensitive hosts`;
  return `${reference} does not resolve to any file in the build`;
}

// True for an href that goes nowhere: empty, "#", "#0", "#!" or a do-nothing javascript: URL.
export function isDeadHref(href) {
  const value = href.trim();
  if (value === "" || value === "#" || value === "#0" || value === "#!") return true;
  return /^javascript:\s*(?:void\s*\(?\s*0?\s*\)?\s*)?;?\s*$/i.test(value);
}

function isAnchorElement(element) {
  return element.name === "a" || element.name === "area";
}

function navigationReferences(page) {
  const references = [];
  for (const element of [...page.all("a"), ...page.all("area")]) {
    if (page.isInTemplate(element)) continue;
    const href = getAttr(element, "href");
    if (href !== null && !isDeadHref(href)) references.push({ element, url: href });
  }
  for (const element of page.all("link")) {
    const href = getAttr(element, "href");
    if (href !== null && linkRels(element).some((rel) => NAVIGATION_RELS.has(rel))) references.push({ element, url: href });
  }
  for (const element of page.all("meta")) {
    if ((getAttr(element, "http-equiv") ?? "").trim().toLowerCase() !== "refresh") continue;
    const match = /url\s*=\s*['"]?([^'"]+)/i.exec(getAttr(element, "content") ?? "");
    if (match) references.push({ element, url: match[1] });
  }
  return references;
}

const brokenInternal = {
  id: "links/broken-internal",
  severity: "error",
  description: "An internal link does not resolve to a built file.",
  page(page, { site, report }) {
    for (const { element, url } of navigationReferences(page)) {
      const resolved = resolveReference(url, page.baseUrl, site);
      if (resolved.kind === "invalid") {
        report({ file: page.file, offset: element.start, message: `Link ${url} is not a valid URL` });
      } else if (resolved.kind === "internal" && site.lookup(resolved.path) === null) {
        report({ file: page.file, offset: element.start, message: `Link ${describeMissing(url, resolved, site)}` });
      }
    }
  },
};

const missingAnchor = {
  id: "links/missing-anchor",
  severity: "error",
  description: "A link fragment does not match any id on its target page.",
  page(page, { site, report }) {
    for (const { element, url } of navigationReferences(page)) {
      if (!isAnchorElement(element)) continue;
      // With a <base> element, even "#part" points at the page the base names.
      const absolute = url.trim().startsWith("#") && page.baseUrl !== page.ownUrl ? new URL(url.trim(), page.baseUrl).href : url;
      const resolved = resolveReference(absolute, page.baseUrl, site);
      if (resolved.kind !== "fragment" && resolved.kind !== "internal") continue;
      const fragment = meaningfulFragment(resolved.fragment);
      if (fragment === null) continue;
      if (resolved.kind === "fragment") {
        if (!page.ids.has(fragment)) {
          report({ file: page.file, offset: element.start, message: `Link ${url} points at an id that is not on this page` });
        }
        continue;
      }
      const target = site.lookup(resolved.path);
      const targetPage = target?.file ? site.page(target.file) : null;
      if (targetPage && !targetPage.ids.has(fragment)) {
        report({ file: page.file, offset: element.start, message: `Link ${url} points at an id that is not on ${target.file}` });
      }
    }
    for (const element of page.all("use")) {
      const url = svgHref(element);
      if (!url?.trim().startsWith("#") || page.isInTemplate(element)) continue;
      if (!page.ids.has(url.trim().slice(1))) {
        report({ file: page.file, offset: element.start, message: `SVG reference ${url} points at an id that is not on this page` });
      }
    }
  },
};

// The URL candidates in a srcset value. URLs may hold commas, so split the way browsers do:
// a URL runs to the next whitespace, and its descriptor runs to the next comma.
export function parseSrcset(value) {
  const urls = [];
  let i = 0;
  while (i < value.length) {
    while (i < value.length && /[\s,]/.test(value[i])) i += 1;
    let start = i;
    while (i < value.length && !/\s/.test(value[i])) i += 1;
    let url = value.slice(start, i);
    if (url === "") break;
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      start = i;
      let depth = 0;
      while (i < value.length && (value[i] !== "," || depth > 0)) {
        if (value[i] === "(") depth += 1;
        else if (value[i] === ")") depth -= 1;
        i += 1;
      }
    }
    urls.push(url);
  }
  return urls;
}

const ASSET_ATTRIBUTES = {
  img: ["src"], source: ["src"], script: ["src"], video: ["src", "poster"], audio: ["src"],
  track: ["src"], iframe: ["src"], embed: ["src"], object: ["data"],
};

function svgHref(element) {
  return getAttr(element, "href") ?? getAttr(element, "xlink:href");
}

function assetReferences(page) {
  const references = [];
  for (const [name, attributes] of Object.entries(ASSET_ATTRIBUTES)) {
    for (const element of page.all(name)) {
      for (const attribute of attributes) {
        const url = getAttr(element, attribute);
        if (url) references.push({ element, url });
      }
    }
  }
  for (const name of ["use", "image"]) {
    for (const element of page.all(name)) {
      const url = svgHref(element);
      if (url) references.push({ element, url });
    }
  }
  for (const name of ["img", "source"]) {
    for (const element of page.all(name)) {
      const srcset = getAttr(element, "srcset");
      if (srcset) for (const url of parseSrcset(srcset)) references.push({ element, url });
    }
  }
  for (const element of page.all("input")) {
    if ((getAttr(element, "type") ?? "").toLowerCase() !== "image") continue;
    const url = getAttr(element, "src");
    if (url) references.push({ element, url });
  }
  for (const element of page.all("link")) {
    const href = getAttr(element, "href");
    if (href && linkRels(element).some((rel) => ASSET_RELS.has(rel))) references.push({ element, url: href });
    const srcset = getAttr(element, "imagesrcset");
    if (srcset) for (const url of parseSrcset(srcset)) references.push({ element, url });
  }
  return references.filter(({ element }) => !page.isInTemplate(element));
}

const brokenAsset = {
  id: "links/broken-asset",
  severity: "error",
  description: "An image, script, stylesheet, font or other referenced file is not in the build.",
  page(page, { site, report }) {
    for (const name of ["img", "script"]) {
      for (const element of page.all(name)) {
        // A script fills in an empty src when the element names a lazy source to use.
        const isLazy = [...element.attrs.keys()].some((attribute) => attribute === "srcset" || attribute.startsWith("data-"));
        if (getAttr(element, "src")?.trim() === "" && !isLazy && !page.isInTemplate(element)) {
          report({ file: page.file, offset: element.start, message: `<${name}> has an empty src` });
        }
      }
    }
    for (const { element, url } of assetReferences(page)) {
      const resolved = resolveReference(url, page.baseUrl, site);
      if (resolved.kind === "internal" && site.lookup(resolved.path) === null) {
        report({ file: page.file, offset: element.start, message: `Referenced file ${describeMissing(url, resolved, site)}` });
      }
    }
  },
  stylesheet(source, { site, report }) {
    const baseUrl = source.page ? source.page.baseUrl : baseUrlForFile(source.file, site);
    const check = (url, offset) => {
      const resolved = resolveReference(url, baseUrl, site);
      if (resolved.kind === "internal" && site.lookup(resolved.path) === null) {
        report({ file: source.file, offset: source.baseOffset + offset, message: `CSS reference ${describeMissing(url, resolved, site)}` });
      }
    };
    for (const declaration of source.declarations) {
      if (declaration.property === "content") continue;
      for (const { url, index } of findUrls(declaration.value)) check(url, declaration.valueOffset + index);
    }
    for (const statement of source.statements) {
      if (statement.name !== "import") continue;
      const target = importTarget(statement);
      if (target) check(target, statement.offset);
    }
  },
};

function anchorText(element) {
  const text = textContent(element);
  if (text) return text;
  const label = getAttr(element, "aria-label");
  if (label) return label.trim();
  const image = element.children.find((child) => child.name === "img");
  return image ? (getAttr(image, "alt") ?? "").trim() : "";
}

// An anchor wired up as a control does not need a destination: a toggle, a tab, a menu.
function isScriptedControl(element) {
  const role = (getAttr(element, "role") ?? "").toLowerCase();
  if (["button", "tab", "menuitem", "switch", "checkbox", "radio"].includes(role)) return true;
  for (const name of element.attrs.keys()) {
    if (name === "aria-expanded" || name === "aria-controls" || name === "aria-haspopup") return true;
    if (/^on[a-z]+$/.test(name) || name.startsWith("@") || name.startsWith("x-on:") || name.startsWith("v-on:") || name.startsWith("hx-")) return true;
    if (name === "data-toggle" || name.startsWith("data-bs-") || name === "data-action") return true;
  }
  return false;
}

function startsWithPhrase(text, phrase) {
  if (!text.startsWith(phrase)) return false;
  const next = text[phrase.length];
  return next === undefined || !/[a-z0-9]/.test(next);
}

const genericNoDestination = {
  id: "links/generic-no-destination",
  severity: "error",
  description: 'A "Read more" style link has no real destination: no href, a dead href, or a link to its own page.',
  options: {
    phrases: [
      "read more", "learn more", "continue reading", "keep reading", "click here", "find out more",
      "see more", "view more", "more info", "more information", "see details", "view details", "details",
    ],
  },
  page(page, { site, options, report }) {
    const phrases = options.phrases.map((phrase) => phrase.toLowerCase());
    for (const element of page.all("a")) {
      if (page.isInTemplate(element)) continue;
      if (isScriptedControl(element) || (element.attrs.has("name") && !element.attrs.has("href"))) continue;
      const text = anchorText(element);
      const lower = text.toLowerCase();
      if (!phrases.some((phrase) => startsWithPhrase(lower, phrase))) continue;
      const href = getAttr(element, "href");
      if (href === null || isDeadHref(href)) {
        report({ file: page.file, offset: element.start, message: `"${text}" link has no destination` });
        continue;
      }
      const resolved = resolveReference(href, page.baseUrl, site);
      if (resolved.kind === "internal" && !resolved.fragment && site.lookup(resolved.path)?.file === page.file) {
        report({ file: page.file, offset: element.start, message: `"${text}" link only points back at its own page` });
      }
    }
  },
};

const placeholderHref = {
  id: "links/placeholder-href",
  severity: "warning",
  description: 'A link has a placeholder href such as "#" and is not wired up as a control.',
  page(page, { site, report }) {
    const generic = phrasesReportedElsewhere(site);
    for (const element of page.all("a")) {
      const href = getAttr(element, "href");
      if (href === null || !isDeadHref(href) || isScriptedControl(element) || page.isInTemplate(element)) continue;
      const lower = anchorText(element).toLowerCase();
      if (generic.some((phrase) => startsWithPhrase(lower, phrase))) continue;
      const shown = href.trim() === "" ? "an empty href" : `href="${href.trim()}"`;
      report({ file: page.file, offset: element.start, message: `Link "${anchorText(element)}" has ${shown}, so it goes nowhere` });
    }
  },
};

// Text that the generic-no-destination rule already reports, so one link is not reported twice.
function phrasesReportedElsewhere(site) {
  const settings = site.config.rules[genericNoDestination.id];
  if (settings.severity === "off") return [];
  return settings.options.phrases.map((phrase) => phrase.toLowerCase());
}

export const linkRules = [brokenInternal, missingAnchor, brokenAsset, genericNoDestination, placeholderHref];
