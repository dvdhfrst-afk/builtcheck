// Reading a page's head the way browsers and search engines do: its title, description,
// canonical and alternate links and icons. The page summary keeps some of these, so the
// site-wide rules can compare pages without holding them all.

import { ancestors, getAttr, normalizeSpace, textContent } from "../html/tree.js";

export function relTokens(element) {
  return (getAttr(element, "rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
}

function isInForeignOrTemplate(element) {
  return ancestors(element).some((parent) => parent.name === "svg" || parent.name === "math" || parent.name === "template");
}

// A whole HTML document rather than a fragment or a verification file that happens to end in
// .html. Head rules only make sense for documents.
export function isDocument(page) {
  if (page.first("html") || page.first("head") || page.first("body") || page.first("title")) return true;
  return /^\s*(?:<!--[^]*?-->\s*)*<!doctype\s+html/i.test(page.source.slice(0, 4096));
}

// The document title element: the first <title> outside SVG, where <title> is a tooltip.
export function titleElement(page) {
  return page.all("title").find((element) => !isInForeignOrTemplate(element)) ?? null;
}

export function pageTitle(page) {
  const element = titleElement(page);
  return element ? textContent(element) : null;
}

export function descriptionElement(page) {
  return page.metaElements("description").find((element) => !page.isInTemplate(element)) ?? null;
}

export function pageDescription(page) {
  const element = descriptionElement(page);
  if (!element) return null;
  return normalizeSpace(getAttr(element, "content") ?? "");
}

export function canonicalLinks(page) {
  return page.all("link").filter((link) => relTokens(link).includes("canonical") && !page.isInTemplate(link));
}

// Links that name a language version of the page: rel="alternate" with an hreflang. An
// hreflang on an <a> is only a hint about the target, and one on a feed link says what
// language the feed is in, so neither is counted.
export function hreflangLinks(page) {
  const links = [];
  for (const element of page.all("link")) {
    const hreflang = getAttr(element, "hreflang");
    const href = getAttr(element, "href");
    if (hreflang === null || href === null || !relTokens(element).includes("alternate") || page.isInTemplate(element)) continue;
    const type = (getAttr(element, "type") ?? "").trim().toLowerCase();
    if (type !== "" && type !== "text/html") continue;
    links.push({ element, hreflang, href, offset: element.start });
  }
  return links;
}

export const ICON_RELS = new Set(["icon", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon"]);

export function iconLinks(page) {
  return page.all("link").filter((link) => {
    const href = getAttr(link, "href");
    return href !== null && href.trim() !== "" && relTokens(link).some((rel) => ICON_RELS.has(rel)) && !page.isInTemplate(link);
  });
}

export function documentLang(page) {
  const html = page.first("html");
  return html ? getAttr(html, "lang") : null;
}

// What the summary of a page keeps for these rules: short strings only.
export function headSummary(page) {
  return {
    document: isDocument(page),
    title: pageTitle(page),
    description: pageDescription(page),
    lang: documentLang(page),
    alternates: hreflangLinks(page).map(({ hreflang, href }) => ({ hreflang, href })),
    icons: iconLinks(page).map((link) => getAttr(link, "href")),
  };
}

// Whether another rule is on, so one fault is not reported by two rules.
export function ruleIsOn(site, id) {
  const settings = site.config.rules[id];
  return Boolean(settings) && settings.severity !== "off";
}

// "a.html, b.html and 3 more"
export function nameFiles(files, limit = 4) {
  if (files.length <= limit) {
    if (files.length <= 1) return files.join("");
    return `${files.slice(0, -1).join(", ")} and ${files[files.length - 1]}`;
  }
  return `${files.slice(0, limit).join(", ")} and ${files.length - limit} more`;
}

// Text cut to a readable length for a message.
export function clip(text, length = 70) {
  const characters = [...text];
  return characters.length <= length ? text : `${characters.slice(0, length - 3).join("")}...`;
}

export function characterCount(text) {
  return [...text].length;
}
