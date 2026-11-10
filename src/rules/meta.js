// Page metadata rules: what a page tells browsers, search engines and social sites about itself.
// Its title and description, canonical URL, top heading, viewport, character encoding, icons
// and share card.

import { hiddenByClass, isInsideHidden } from "../html/page.js";
import { ancestors, getAttr, textContent, walk } from "../html/tree.js";
import { isErrorPage, isIndexable, isRedirectPage } from "../site/classify.js";
import { makeMatcher } from "../site/glob.js";
import { isLocalHost } from "../site/site.js";
import { resolveReference } from "../site/urls.js";
import {
  canonicalLinks, characterCount, clip, descriptionElement, iconLinks, isDocument, nameFiles,
  pageDescription, pageTitle, relTokens, ruleIsOn, titleElement,
} from "../seo/head.js";

// A content page someone opens as a document: not a fragment, a verification file or a
// redirect stub, and not an error page or application shell, which are left alone like
// everywhere else in builtcheck.
function isOpenedDocument(page) {
  return isDocument(page) && !isRedirectPage(page) && !isErrorPage(page);
}

// ---- Title and description

const titleMissing = {
  id: "meta/title-missing",
  severity: "error",
  description: "A page has no <title>, or an empty one.",
  page(page, { report }) {
    if (!isOpenedDocument(page)) return;
    const element = titleElement(page);
    if (!element) {
      report({ file: page.file, offset: page.first("head")?.start ?? null, message: "Page has no <title>, so browsers and search results show its address instead" });
    } else if (pageTitle(page) === "") {
      report({ file: page.file, offset: element.start, message: "Page title is empty" });
    }
  },
};

const titleLength = {
  id: "meta/title-length",
  severity: "warning",
  description: "An indexable page has a title shorter or longer than the configured lengths.",
  options: { minLength: 10, maxLength: 60 },
  page(page, { options, report }) {
    if (!isIndexable(page)) return;
    const title = pageTitle(page);
    if (!title) return;
    const length = characterCount(title);
    const offset = titleElement(page).start;
    if (length > options.maxLength) {
      report({ file: page.file, offset, message: `Title is ${length} characters, over ${options.maxLength}, so search results cut it short: "${clip(title)}"` });
    } else if (length < options.minLength) {
      report({ file: page.file, offset, message: `Title "${title}" is ${length} characters, under ${options.minLength}, which says little about the page` });
    }
  },
};

const descriptionMissing = {
  id: "meta/description-missing",
  severity: "warning",
  description: "An indexable page has no meta description, or an empty one.",
  page(page, { report }) {
    if (!isIndexable(page) || !isDocument(page)) return;
    const element = descriptionElement(page);
    if (!element) {
      report({ file: page.file, message: "Page has no meta description, so search results show a snippet of their own choosing" });
    } else if (pageDescription(page) === "") {
      report({ file: page.file, offset: element.start, message: "Meta description is empty" });
    }
  },
};

const descriptionLength = {
  id: "meta/description-length",
  severity: "warning",
  description: "An indexable page has a meta description longer than the configured length.",
  options: { maxLength: 160 },
  page(page, { options, report }) {
    if (!isIndexable(page)) return;
    const description = pageDescription(page);
    if (!description) return;
    const length = characterCount(description);
    if (length > options.maxLength) {
      report({
        file: page.file,
        offset: descriptionElement(page).start,
        message: `Meta description is ${length} characters, over ${options.maxLength}, so search results cut it short`,
      });
    }
  },
};

const duplicateGroups = new WeakMap();

// Indexable pages grouped by a normalized value. Result: Map of value to files, in file order.
function groupsFor(site, id, summaryValue, exclude) {
  if (!duplicateGroups.has(site)) duplicateGroups.set(site, new Map());
  const cache = duplicateGroups.get(site);
  if (cache.has(id)) return cache.get(id);
  const excluded = makeMatcher(exclude);
  const groups = new Map();
  for (const summary of site.pages) {
    const value = summaryValue(summary);
    if (!value || excluded(summary.file) || !isIndexable(summary)) continue;
    const key = value.toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(summary.file);
  }
  cache.set(id, groups);
  return groups;
}

// One finding per group of pages sharing a value, on the first page, naming the rest.
function duplicateRule({ id, what, summaryValue, pageValue, elementOf }) {
  return {
    id,
    severity: "warning",
    description: `Several indexable pages share the same ${what}.`,
    options: { exclude: [] },
    page(page, { site, options, report }) {
      if (!isIndexable(page)) return;
      const value = pageValue(page);
      if (!value) return;
      const files = groupsFor(site, id, summaryValue, options.exclude).get(value.toLowerCase());
      if (!files || files.length < 2 || files[0] !== page.file) return;
      const others = files.slice(1);
      report({
        file: page.file,
        offset: elementOf(page)?.start ?? null,
        message: `${what[0].toUpperCase()}${what.slice(1)} "${clip(value)}" is also used by ${nameFiles(others)}, so search engines cannot tell ${others.length > 1 ? "these pages" : "the two pages"} apart`,
      });
    },
  };
}

const titleDuplicate = duplicateRule({
  id: "meta/title-duplicate",
  what: "title",
  summaryValue: (summary) => summary.title,
  pageValue: pageTitle,
  elementOf: titleElement,
});

const descriptionDuplicate = duplicateRule({
  id: "meta/description-duplicate",
  what: "meta description",
  summaryValue: (summary) => summary.description,
  pageValue: pageDescription,
  elementOf: descriptionElement,
});

// ---- Canonical links

function canonicalHrefs(page) {
  return canonicalLinks(page).map((element) => ({ element, href: getAttr(element, "href") }));
}

// The same string for two hrefs that name the same place.
function canonicalKey(href, page, site) {
  const resolved = resolveReference(href, page.baseUrl, site);
  if (resolved.kind === "internal") return `file:${site.lookup(resolved.path)?.file ?? resolved.path}`;
  try {
    return new URL(href.trim(), page.baseUrl).href;
  } catch {
    return href.trim();
  }
}

const canonicalMultiple = {
  id: "meta/canonical-multiple",
  severity: "error",
  description: "A page has more than one canonical link, naming different URLs.",
  page(page, { site, report }) {
    const links = canonicalHrefs(page).filter(({ href }) => href !== null && href.trim() !== "");
    if (links.length < 2) return;
    if (new Set(links.map(({ href }) => canonicalKey(href, page, site))).size < 2) return;
    report({
      file: page.file,
      offset: links[1].element.start,
      message: `Page has ${links.length} canonical links naming different URLs (${nameFiles(links.map(({ href }) => href.trim()))}), so search engines may ignore them all`,
    });
  },
};

const canonicalInvalid = {
  id: "meta/canonical-invalid",
  severity: "error",
  description: "A canonical link is empty, malformed, not a web address, points at a local address or sits in the body.",
  page(page, { site, report }) {
    for (const { element, href } of canonicalHrefs(page)) {
      const at = (message) => report({ file: page.file, offset: element.start, message });
      if (href === null || href.trim() === "") {
        at(href === null ? "Canonical link has no href" : "Canonical link has an empty href");
        continue;
      }
      if (ancestors(element).some((parent) => parent.name === "body")) {
        at("Canonical link is in the body, where search engines ignore it. Move it into the head");
      }
      const url = href.trim();
      const resolved = resolveReference(url, page.baseUrl, site);
      if (resolved.kind === "invalid") {
        // The link rules already report a link that is not a valid URL.
        if (!ruleIsOn(site, "links/broken-internal")) at(`Canonical URL ${url} is not a valid URL`);
      } else if (resolved.kind === "scheme") {
        at(`Canonical URL ${url} is not a web address`);
      } else if (resolved.kind === "fragment") {
        at(`Canonical URL ${url} is only a fragment, not a page address`);
      } else if (/^https?:\/\//i.test(url)) {
        const { hostname } = new URL(url);
        if (isLocalHost(hostname)) at(`Canonical URL ${url} points at a local address, probably left over from a development build`);
      }
    }
  },
};

const canonicalRelative = {
  id: "meta/canonical-relative",
  severity: "warning",
  description: "A canonical link uses a relative URL instead of an absolute one.",
  page(page, { site, report }) {
    for (const { element, href } of canonicalHrefs(page)) {
      if (href === null || href.trim() === "" || /^https?:\/\//i.test(href.trim())) continue;
      const kind = resolveReference(href, page.baseUrl, site).kind;
      if (kind !== "internal" && kind !== "external" && kind !== "outside") continue;
      report({
        file: page.file,
        offset: element.start,
        message: `Canonical URL ${href.trim()} is relative. Use an absolute URL with the scheme and host, so copies of the page on other addresses still point home`,
      });
    }
  },
};

// The page a summary's own canonical names, if it names a different built page.
function canonicalElsewhere(summary, site) {
  if (!summary.canonicalHref) return null;
  const resolved = resolveReference(summary.canonicalHref, summary.baseUrl, site);
  if (resolved.kind === "external") return summary.canonicalHref.trim();
  if (resolved.kind !== "internal") return null;
  const file = site.lookup(resolved.path)?.file;
  return file && file !== summary.file ? file : null;
}

const canonicalTarget = {
  id: "meta/canonical-target",
  severity: "error",
  description: "A canonical link names a page that is not in the build, redirects, asks not to be indexed, is an error page or names another canonical.",
  page(page, { site, report }) {
    for (const { element, href } of canonicalHrefs(page)) {
      if (href === null || href.trim() === "") continue;
      const url = href.trim();
      const resolved = resolveReference(url, page.baseUrl, site);
      if (resolved.kind !== "internal") continue;
      const at = (message) => report({ file: page.file, offset: element.start, message: `Canonical URL ${url} ${message}` });
      const target = site.lookup(resolved.path);
      if (target === null) {
        // The link rules already report an internal link with nothing behind it.
        if (!ruleIsOn(site, "links/broken-internal")) at("is not in the build");
        continue;
      }
      if (target.redirect) {
        at(`redirects (to ${target.redirect.target}). Name the page it leads to instead`);
        continue;
      }
      const summary = target.file ? site.page(target.file) : null;
      if (!summary || summary.file === page.file) continue;
      if (summary.noindex) at(`names ${summary.file}, which asks not to be indexed`);
      else if (summary.redirect) at(`names ${summary.file}, which only redirects`);
      else if (isErrorPage(summary)) at(`names ${summary.file}, which is an error page`);
      else {
        const next = canonicalElsewhere(summary, site);
        if (next) at(`names ${summary.file}, which names ${next} as its own canonical. Point straight at the final page`);
      }
    }
  },
};

const canonicalHost = {
  id: "meta/canonical-host",
  severity: "warning",
  description: "A canonical link names another host than the site's, or the other scheme of the configured site URL.",
  page(page, { site, report }) {
    if (!site.ownHost) return;
    const configured = site.config.site.url ? new URL(site.config.site.url) : null;
    for (const { element, href } of canonicalHrefs(page)) {
      const url = href?.trim() ?? "";
      if (!/^https?:\/\//i.test(url)) continue;
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (isLocalHost(parsed.hostname)) continue;
      const at = (message) => report({ file: page.file, offset: element.start, message });
      if (!site.isOwnHost(parsed.hostname)) {
        at(`Canonical URL ${url} is on ${parsed.hostname}, not the site host ${site.ownHost}. That hands this page's search ranking to the other site`);
      } else if (configured && parsed.protocol !== configured.protocol) {
        at(`Canonical URL ${url} uses ${parsed.protocol.slice(0, -1)}, but the site URL uses ${configured.protocol.slice(0, -1)}`);
      }
    }
  },
};

// ---- Top heading

function headingLabel(element) {
  const text = textContent(element);
  if (text) return text;
  const label = getAttr(element, "aria-label");
  if (label && label.trim()) return label.trim();
  // A logo as the heading, perhaps inside a link home.
  let alt = "";
  walk(element, (node) => {
    if (alt !== "" || node.type !== "element") return false;
    if (node.name === "img") alt = (getAttr(node, "alt") ?? "").trim();
    return true;
  });
  return alt;
}

// The h1 elements a reader can see at some width, with something in them.
function shownH1s(page) {
  return page.all("h1").filter((element) =>
    !page.isInTemplate(element) && !isInsideHidden(element) && !page.styles?.isAlwaysHidden(element) && headingLabel(element) !== "");
}

const h1Missing = {
  id: "meta/h1-missing",
  severity: "warning",
  description: "An indexable page has no visible h1 heading.",
  page(page, { report }) {
    if (!isIndexable(page) || !isDocument(page)) return;
    if (shownH1s(page).length > 0) return;
    const hidden = page.all("h1").find((element) => !page.isInTemplate(element));
    report({
      file: page.file,
      offset: hidden?.start ?? null,
      message: hidden ? "Page's only h1 heading is hidden or empty, so it has no visible top heading" : "Page has no h1 heading saying what it is about",
    });
  },
};

const h1Multiple = {
  id: "meta/h1-multiple",
  severity: "warning",
  description: "An indexable page has more than one visible h1 heading.",
  page(page, { report }) {
    if (!isIndexable(page)) return;
    // A copy shown only at some widths stands in for the other, so it is not a second heading.
    const always = shownH1s(page).filter((element) => !hiddenByClass(element) && !page.styles?.isSometimesHidden(element));
    if (always.length < 2) return;
    report({
      file: page.file,
      offset: always[1].start,
      message: `Page has ${always.length} visible h1 headings ("${clip(headingLabel(always[0]), 40)}" and "${clip(headingLabel(always[1]), 40)}"${always.length > 2 ? " and more" : ""}). Keep one and make the rest h2`,
    });
  },
};

// ---- Viewport and character encoding

function viewportSettings(content) {
  const settings = new Map();
  for (const part of content.split(/[,;]/)) {
    const equals = part.indexOf("=");
    if (equals === -1) continue;
    settings.set(part.slice(0, equals).trim().toLowerCase(), part.slice(equals + 1).trim().toLowerCase());
  }
  return settings;
}

function viewportElement(page) {
  return page.metaElements("viewport").find((element) => !page.isInTemplate(element)) ?? null;
}

const viewportMissing = {
  id: "meta/viewport-missing",
  severity: "warning",
  description: "A page has no viewport meta tag, so phones show it at desktop width.",
  page(page, { report }) {
    if (!isOpenedDocument(page) || viewportElement(page)) return;
    report({ file: page.file, message: 'Page has no viewport meta tag, so phones show it zoomed out at desktop width. Add <meta name="viewport" content="width=device-width, initial-scale=1">' });
  },
};

const viewportZoom = {
  id: "meta/viewport-zoom",
  severity: "error",
  description: "The viewport meta tag stops people from zooming in.",
  options: { minMaximumScale: 2 },
  page(page, { options, report }) {
    if (!isOpenedDocument(page)) return;
    const element = viewportElement(page);
    if (!element) return;
    const settings = viewportSettings(getAttr(element, "content") ?? "");
    const scalable = settings.get("user-scalable");
    const at = (message) => report({ file: page.file, offset: element.start, message });
    if (scalable !== undefined && (scalable === "no" || (/^-?[0-9.]+$/.test(scalable) && Math.abs(Number(scalable)) < 1))) {
      at(`Viewport sets user-scalable=${scalable}, which stops people from zooming in to read`);
    }
    const maximum = Number(settings.get("maximum-scale"));
    if (settings.has("maximum-scale") && Number.isFinite(maximum) && maximum > 0 && maximum < options.minMaximumScale) {
      at(`Viewport sets maximum-scale=${settings.get("maximum-scale")}, which stops people from zooming in to ${options.minMaximumScale}x to read`);
    }
  },
};

const UTF8 = /^(?:utf-?8|unicode-1-1-utf-8)$/i;

function charsetDeclaration(page) {
  for (const meta of page.all("meta")) {
    if (page.isInTemplate(meta)) continue;
    const charset = getAttr(meta, "charset");
    if (charset !== null) return { element: meta, label: charset.trim() };
    if ((getAttr(meta, "http-equiv") ?? "").trim().toLowerCase() === "content-type") {
      const match = /charset\s*=\s*["']?\s*([^\s"';]+)/i.exec(getAttr(meta, "content") ?? "");
      if (match) return { element: meta, label: match[1] };
    }
  }
  return null;
}

function startsWithByteOrderMark(site, file) {
  const buffer = site.readBuffer(file);
  if (!buffer) return true;
  return (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) || (buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff);
}

const charset = {
  id: "meta/charset",
  severity: "warning",
  description: "A page declares no character encoding, declares it after the first 1024 bytes, or declares one other than UTF-8.",
  page(page, { site, report }) {
    if (!isOpenedDocument(page)) return;
    const declared = charsetDeclaration(page);
    if (!declared) {
      // A byte order mark declares the encoding too, and is gone once the page is decoded.
      if (startsWithByteOrderMark(site, page.file)) return;
      report({ file: page.file, message: 'Page declares no character encoding, so browsers may guess wrong and garble accented letters. Add <meta charset="utf-8"> at the top of the head' });
      return;
    }
    const at = (message) => report({ file: page.file, offset: declared.element.start, message });
    const end = Buffer.byteLength(page.source.slice(0, declared.element.tagEnd), "utf8");
    if (end > 1024) {
      at(`Character encoding is declared ${end} bytes in, after the first 1024 bytes where browsers look for it. Move it to the top of the head`);
    } else if (!UTF8.test(declared.label)) {
      at(`Page declares the ${declared.label} character encoding. HTML requires UTF-8`);
    }
  },
};

// ---- Icons

const IMAGE_EXTENSION = /\.(?:ico|cur|png|svg|gif|jpe?g|webp|avif|bmp)$/i;

const faviconMissing = {
  id: "meta/favicon-missing",
  severity: "warning",
  description: "The site has no favicon: no favicon.ico at the root of the build and no page links an icon that exists.",
  site({ site, report }) {
    if (!site.pages.some((summary) => summary.document) || site.hasFile("favicon.ico")) return;
    for (const summary of site.pages) {
      for (const href of summary.icons) {
        const resolved = resolveReference(href, summary.baseUrl, site);
        if (resolved.kind === "scheme" || resolved.kind === "external") return;
        if (resolved.kind === "internal" && site.lookup(resolved.path)) return;
      }
    }
    report({ file: "favicon.ico", message: "The site has no favicon: no favicon.ico at the root of the build, and no page links an icon that exists, so browser tabs and bookmarks show a blank icon" });
  },
};

const emptyFiles = new WeakMap();

function isEmptyFile(site, file) {
  if (!emptyFiles.has(site)) emptyFiles.set(site, new Map());
  const known = emptyFiles.get(site);
  if (!known.has(file)) known.set(file, site.readBuffer(file)?.length === 0);
  return known.get(file);
}

const iconBroken = {
  id: "meta/icon-broken",
  severity: "error",
  description: "An icon or touch icon link names a file that is missing, empty or not an image.",
  page(page, { site, report }) {
    for (const element of iconLinks(page)) {
      const href = getAttr(element, "href").trim();
      const resolved = resolveReference(href, page.baseUrl, site);
      if (resolved.kind !== "internal") continue;
      const at = (message) => report({ file: page.file, offset: element.start, message: `Icon ${href} ${message}` });
      const target = site.lookup(resolved.path);
      if (target === null) {
        // The link rules already report a referenced file that is not in the build.
        if (!ruleIsOn(site, "links/broken-asset")) at("is not in the build");
        continue;
      }
      if (!target.file) continue;
      const touch = relTokens(element).some((rel) => rel.startsWith("apple-touch-icon"));
      if (!IMAGE_EXTENSION.test(target.file)) at(`leads to ${target.file}, which is not an image`);
      else if (touch && /\.(?:svg|ico)$/i.test(target.file)) at("is a touch icon in a format iPhones and iPads do not use. Give them a PNG, 180 by 180");
      else if (isEmptyFile(site, target.file)) at("is an empty file");
    }
  },
};

// ---- Social cards

function metaValue(page, key) {
  const element = page.metaElements(key).find((meta) => !page.isInTemplate(meta));
  if (!element) return null;
  return { element, value: (getAttr(element, "content") ?? "").trim() };
}

const ogMissing = {
  id: "meta/og-missing",
  severity: "warning",
  description: "An indexable page lacks Open Graph properties that social sites show when it is shared.",
  options: { properties: ["og:title", "og:description"] },
  page(page, { options, report }) {
    if (!isIndexable(page) || !isDocument(page)) return;
    const missing = options.properties.filter((key) => !metaValue(page, key)?.value);
    if (missing.length === 0) return;
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} or ${missing[missing.length - 1]}`;
    report({ file: page.file, message: `Page has no ${list}, so a share of it shows whatever the social site guesses` });
  },
};

const ogUrl = {
  id: "meta/og-url",
  severity: "warning",
  description: "og:url is not an absolute URL, or names a different URL from the canonical link.",
  page(page, { report }) {
    const og = metaValue(page, "og:url");
    if (!og || og.value === "") return;
    const at = (message) => report({ file: page.file, offset: og.element.start, message });
    if (!/^https?:\/\//i.test(og.value)) {
      at(`og:url ${og.value} is not an absolute URL, which Open Graph requires`);
      return;
    }
    const canonical = page.canonicalHref?.trim();
    if (!canonical || !/^https?:\/\//i.test(canonical)) return;
    let same;
    try {
      same = new URL(og.value).href === new URL(canonical).href;
    } catch {
      return;
    }
    if (!same) at(`og:url ${og.value} differs from the canonical URL ${canonical}, so shares and search count this page under two addresses`);
  },
};

const twitterCard = {
  id: "meta/twitter-card",
  severity: "warning",
  description: "twitter:card has a value that is not a known card type.",
  options: { values: ["summary", "summary_large_image", "app", "player"] },
  page(page, { options, report }) {
    for (const element of page.metaElements("twitter:card")) {
      if (page.isInTemplate(element)) continue;
      const value = (getAttr(element, "content") ?? "").trim();
      if (options.values.some((known) => known.toLowerCase() === value.toLowerCase())) continue;
      report({
        file: page.file,
        offset: element.start,
        message: value === "" ? "twitter:card is empty" : `twitter:card "${clip(value, 40)}" is not a card type (${options.values.join(", ")}), so no card is shown`,
      });
    }
  },
};

export const metaRules = [
  titleMissing, titleLength, titleDuplicate,
  descriptionMissing, descriptionLength, descriptionDuplicate,
  canonicalMultiple, canonicalInvalid, canonicalRelative, canonicalTarget, canonicalHost,
  h1Missing, h1Multiple,
  viewportMissing, viewportZoom, charset,
  faviconMissing, iconBroken,
  ogMissing, ogUrl, twitterCard,
];
