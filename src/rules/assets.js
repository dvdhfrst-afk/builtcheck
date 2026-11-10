// Asset and page weight rules: files too heavy to send, images that move the page as they load or
// carry more pixels than they are shown at, scripts that hold up the first paint, fonts that hide
// text, copies of one file under several names, and insecure loads on a secure site.

import { findUrls, importTarget } from "../css/scanner.js";
import { isInsideHidden } from "../html/page.js";
import { getAttr } from "../html/tree.js";
import { contentHash, fileBytes, formatBytes, imageInfo, isAssetFile, isImageFile, isScriptFile, isStylesheetFile } from "../assets/files.js";
import { fontFaceUrls, isFontFaceDeclaration, isInHead, isInert, pageSubresources, stylesheetBaseUrl } from "../assets/references.js";
import { parseSrcset } from "./links.js";
import { isLocalHost } from "../site/site.js";
import { resolveReference } from "../site/urls.js";

const KILOBYTE = 1024;

// The built file a reference leads to, or null for anything else.
function builtFile(url, baseUrl, site) {
  const resolved = resolveReference(url, baseUrl, site);
  return resolved.kind === "internal" ? site.lookup(resolved.path)?.file ?? null : null;
}

function filesOfKind(site, test) {
  return [...site.files].filter((file) => test(file) && !site.ignored(file));
}

function sizeBudgetRule({ id, description, test, noun, maxKilobytes, advice }) {
  return {
    id,
    severity: "warning",
    description,
    options: { maxKilobytes },
    site({ site, options, report }) {
      const limit = options.maxKilobytes * KILOBYTE;
      for (const file of filesOfKind(site, test)) {
        const bytes = fileBytes(site, file);
        if (bytes !== null && bytes > limit) {
          report({ file, message: `${noun} is ${formatBytes(bytes)}, over the ${options.maxKilobytes} KB budget. ${advice}` });
        }
      }
    },
  };
}

const largeImage = sizeBudgetRule({
  id: "assets/large-image",
  description: "An image file is larger than the byte budget.",
  test: isImageFile,
  noun: "Image",
  maxKilobytes: 500,
  advice: "Compress it, resize it, or serve it as WebP or AVIF.",
});

const largeStylesheet = sizeBudgetRule({
  id: "assets/large-stylesheet",
  description: "A stylesheet file is larger than the byte budget.",
  test: isStylesheetFile,
  noun: "Stylesheet",
  maxKilobytes: 200,
  advice: "Minify it and remove unused rules, or split it by page.",
});

const largeScript = sizeBudgetRule({
  id: "assets/large-script",
  description: "A script file is larger than the byte budget.",
  test: isScriptFile,
  noun: "Script",
  maxKilobytes: 500,
  advice: "Minify it, or split it so each page loads only what it uses.",
});

// Browsers ask for these at fixed paths whatever the pages say, so a copy elsewhere is expected.
const FIXED_PATH_FILES = new Set(["favicon.ico", "apple-touch-icon.png", "apple-touch-icon-precomposed.png"]);

const duplicateFile = {
  id: "assets/duplicate-file",
  severity: "warning",
  description: "The same file content is published under several paths.",
  options: { minKilobytes: 1 },
  site({ site, options, report }) {
    const bySize = new Map();
    for (const file of filesOfKind(site, isAssetFile)) {
      if (FIXED_PATH_FILES.has(file)) continue;
      const bytes = fileBytes(site, file);
      if (bytes === null || bytes < options.minKilobytes * KILOBYTE || bytes === 0) continue;
      if (!bySize.has(bytes)) bySize.set(bytes, []);
      bySize.get(bytes).push(file);
    }
    // Only files of equal size can be equal, so most files are never read.
    for (const [bytes, files] of bySize) {
      if (files.length < 2) continue;
      const byHash = new Map();
      for (const file of files) {
        const hash = contentHash(site, file);
        if (hash === null) continue;
        if (!byHash.has(hash)) byHash.set(hash, []);
        byHash.get(hash).push(file);
      }
      for (const group of byHash.values()) {
        if (group.length < 2) continue;
        group.sort();
        const others = group.slice(1);
        const named = others.length > 5 ? `${others.slice(0, 5).join(", ")} and ${others.length - 5} more` : others.join(", ");
        report({
          file: group[0],
          message: `Same content (${formatBytes(bytes)}) is also published as ${named}. Keep one copy and point every reference at it, so browsers download and cache it once`,
        });
      }
    }
  },
};

const NOT_A_SIZE = /^(?:auto|initial|inherit|unset|revert|revert-layer|none|)$/i;

// Whether any stylesheet rule could give the element this property with a real value. Rules that
// apply only at some widths count too: when unsure, stay quiet.
function cssSets(page, element, properties) {
  if (!page.styles) return false;
  return properties.some((property) => page.styles.matchedDeclarations(element, property).some((entry) => !NOT_A_SIZE.test(entry.value.trim())));
}

function cssWinner(page, element, property) {
  const winner = page.styles?.cascaded(element, property).winner;
  return winner ? winner.value.trim().toLowerCase() : null;
}

// Images a browser does not lay out in the flow of the page, or does not show at all.
function isOutOfFlowOrHidden(page, element) {
  if (isInert(page, element) || isInsideHidden(element) || page.styles?.isAlwaysHidden(element)) return true;
  const position = cssWinner(page, element, "position");
  return position === "absolute" || position === "fixed";
}

function attributeLength(element, name) {
  const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/i.exec(getAttr(element, name) ?? "");
  return match ? Number(match[1]) : null;
}

function imageLabel(element) {
  const src = getAttr(element, "src");
  if (src && src.trim() !== "") return src.trim();
  const [first] = parseSrcset(getAttr(element, "srcset") ?? "");
  return first ?? "<img>";
}

const imgMissingDimensions = {
  id: "assets/img-missing-dimensions",
  severity: "warning",
  description: "An img has no width and height attributes, and no CSS gives it a size or aspect ratio, so the page shifts as it loads.",
  page(page, { report }) {
    for (const element of page.all("img")) {
      if (!getAttr(element, "src")?.trim() && !getAttr(element, "srcset")?.trim()) continue;
      const width = getAttr(element, "width")?.trim() || null;
      const height = getAttr(element, "height")?.trim() || null;
      if (width && height) continue;
      if (isOutOfFlowOrHidden(page, element)) continue;
      if (cssSets(page, element, ["aspect-ratio"])) continue;
      const hasWidth = width !== null || cssSets(page, element, ["width", "inline-size"]);
      const hasHeight = height !== null || cssSets(page, element, ["height", "block-size"]);
      if (hasWidth && hasHeight) continue;
      const missing = !width && !height ? "no width and height attributes" : width ? "a width but no height attribute" : "a height but no width attribute";
      report({
        file: page.file,
        offset: element.start,
        message: `Image ${imageLabel(element)} has ${missing}, so the page shifts when it loads. Add the image's size, or give it an aspect-ratio in CSS`,
      });
    }
  },
};

// The candidates of a srcset with their descriptors: [{ url, density }] or [{ url, width }].
// parseSrcset finds where each URL ends; the descriptor is what follows it, up to the comma.
export function srcsetCandidates(value) {
  const candidates = [];
  let cursor = 0;
  for (const url of parseSrcset(value)) {
    const at = value.indexOf(url, cursor);
    if (at === -1) break;
    let end = at + url.length;
    let depth = 0;
    while (end < value.length && (value[end] !== "," || depth > 0)) {
      if (value[end] === "(") depth += 1;
      else if (value[end] === ")") depth -= 1;
      end += 1;
    }
    const descriptor = value.slice(at + url.length, end).trim().toLowerCase();
    cursor = end;
    const density = /^(\d+(?:\.\d+)?|\.\d+)x$/.exec(descriptor);
    const width = /^(\d+)w$/.exec(descriptor);
    if (descriptor === "") candidates.push({ url, density: 1 });
    else if (density && Number(density[1]) > 0) candidates.push({ url, density: Number(density[1]) });
    else if (width && Number(width[1]) > 0) candidates.push({ url, width: Number(width[1]) });
  }
  return candidates;
}

// Small files cost little however many pixels they waste.
const MIN_OVERSIZED_BYTES = 16 * KILOBYTE;

function displaySize(page, element) {
  const css = (property) => {
    const value = cssWinner(page, element, property);
    const match = value ? /^(\d+(?:\.\d+)?)px$/.exec(value) : null;
    return match ? Number(match[1]) : null;
  };
  const width = attributeLength(element, "width") ?? css("width");
  const height = attributeLength(element, "height") ?? css("height");
  return width || height ? { width, height } : null;
}

const oversizedImage = {
  id: "assets/oversized-image",
  severity: "warning",
  description: "An image has far more pixels than the size it is shown at needs.",
  options: { ratio: 3 },
  page(page, { site, options, report }) {
    for (const element of page.all("img")) {
      if (isInert(page, element)) continue;
      const shown = displaySize(page, element);
      if (!shown) continue;
      const measure = (url) => {
        const file = builtFile(url, page.baseUrl, site);
        const info = file ? imageInfo(site, file) : null;
        if (!info || info.vector || info.format === "ico" || fileBytes(site, file) < MIN_OVERSIZED_BYTES) return null;
        // Compare on width where the page gives one, as that is what layouts fix.
        const scale = shown.width ? info.width / shown.width : info.height / shown.height;
        return { info, scale };
      };
      const candidates = srcsetCandidates(getAttr(element, "srcset") ?? "");
      const byWidth = candidates.filter((candidate) => candidate.width);
      let worst = null;
      if (byWidth.length > 0) {
        // The browser picks among these by screen; even the smallest is more than any needs.
        const smallest = byWidth.sort((a, b) => a.width - b.width)[0];
        const measured = measure(smallest.url);
        if (measured && measured.scale > options.ratio) worst = { url: smallest.url, ...measured, smallest: true };
      } else {
        const src = getAttr(element, "src");
        const all = [...candidates];
        if (src?.trim() && !all.some((candidate) => candidate.density === 1)) all.push({ url: src.trim(), density: 1 });
        for (const candidate of all) {
          const measured = measure(candidate.url);
          if (!measured) continue;
          const excess = measured.scale / candidate.density;
          if (excess > options.ratio && (!worst || excess > worst.excess)) worst = { url: candidate.url, ...measured, excess, density: candidate.density };
        }
      }
      if (!worst) continue;
      const { info } = worst;
      const shownAs = shown.width ? `${shown.width} pixels wide` : `${shown.height} pixels high`;
      const times = (worst.excess ?? worst.scale).toFixed(1);
      const which = worst.smallest ? `The smallest srcset candidate, ${worst.url},` : worst.density > 1 ? `${worst.url}, the ${worst.density}x candidate,` : worst.url;
      report({
        file: page.file,
        offset: element.start,
        message: `${which} is ${info.width}x${info.height} but shown at ${shownAs}, ${times} times what the screen needs. Serve a smaller file, or add smaller srcset candidates`,
      });
    }
  },
};

const WEIGHT_GROUPS = [["html", "HTML"], ["stylesheet", "CSS"], ["script", "scripts"], ["font", "fonts"], ["image", "images"]];

const pageWeight = {
  id: "assets/page-weight",
  severity: "warning",
  description: "A page and the CSS, scripts, fonts and images it loads from the build weigh more than the budget.",
  options: { maxKilobytes: 3072 },
  page(page, { site, options, report }) {
    const counted = new Map();
    const count = (file, kind) => {
      if (file && !counted.has(file)) counted.set(file, kind);
    };
    count(page.file, "html");
    for (const { source } of page.styles?.sources ?? []) {
      if (source.kind === "file") count(source.file, "stylesheet");
      const baseUrl = stylesheetBaseUrl(source, site);
      for (const { url } of fontFaceUrls(source)) count(builtFile(url, baseUrl, site), "font");
    }
    const imagesWithSource = new Set();
    for (const { element, url, kind, candidate } of pageSubresources(page)) {
      if (kind === "stylesheet" || kind === "script" || kind === "font") {
        count(builtFile(url, page.baseUrl, site), kind);
      } else if (kind === "image" && element.name !== "source") {
        // A browser fetches one image per element: the src, or a srcset choice when there is none.
        if (candidate && imagesWithSource.has(element)) continue;
        const file = builtFile(url, page.baseUrl, site);
        if (file) {
          imagesWithSource.add(element);
          count(file, "image");
        }
      }
    }
    const totals = new Map();
    let total = 0;
    for (const [file, kind] of counted) {
      const bytes = fileBytes(site, file) ?? 0;
      totals.set(kind, (totals.get(kind) ?? 0) + bytes);
      total += bytes;
    }
    if (total <= options.maxKilobytes * KILOBYTE) return;
    const parts = WEIGHT_GROUPS.filter(([kind]) => totals.get(kind) > 0).map(([kind, label]) => `${label} ${formatBytes(totals.get(kind))}`);
    report({
      file: page.file,
      message: `Page loads ${formatBytes(total)} from the build (${parts.join(", ")}), over the ${options.maxKilobytes} KB budget`,
    });
  },
};

const CLASSIC_SCRIPT_TYPES = new Set(["", "text/javascript", "application/javascript", "application/ecmascript", "text/ecmascript", "application/x-javascript"]);

const renderBlockingScript = {
  id: "assets/render-blocking-script",
  severity: "warning",
  description: "A script in head loads without async, defer or type=module, so nothing shows until it has downloaded and run.",
  page(page, { report }) {
    for (const element of page.all("script")) {
      const src = getAttr(element, "src");
      if (!src?.trim() || !isInHead(page, element) || isInert(page, element)) continue;
      const type = (getAttr(element, "type") ?? "").trim().toLowerCase().split(";")[0].trim();
      if (!CLASSIC_SCRIPT_TYPES.has(type)) continue;
      if (["async", "defer", "nomodule"].some((name) => element.attrs.has(name))) continue;
      report({
        file: page.file,
        offset: element.start,
        message: `Script ${src.trim()} in <head> blocks rendering until it downloads and runs. Add defer (or async), or move it to the end of <body>`,
      });
    }
  },
};

const fontDisplay = {
  id: "assets/font-display",
  severity: "warning",
  description: "An @font-face rule has no font-display, so text can stay invisible while the font loads.",
  stylesheet(source, { report }) {
    const blocks = new Map();
    for (const declaration of source.declarations) {
      if (!isFontFaceDeclaration(declaration)) continue;
      if (!blocks.has(declaration.block)) blocks.set(declaration.block, { offset: declaration.offset, family: null, src: false, display: false });
      const block = blocks.get(declaration.block);
      if (declaration.property === "font-family") block.family = declaration.value.trim().replace(/^["']|["']$/g, "");
      if (declaration.property === "src") block.src = true;
      if (declaration.property === "font-display") block.display = true;
    }
    for (const block of blocks.values()) {
      if (!block.src || block.display) continue;
      const name = block.family ? ` for "${block.family}"` : "";
      report({
        file: source.file,
        offset: source.baseOffset + block.offset,
        message: `@font-face${name} has no font-display, so text can stay invisible while the font loads. Add font-display: swap, or optional`,
      });
    }
  },
};

const schemes = new WeakMap();

// Whether the site is served over HTTPS: from the configured URL, or else from what its sitemap
// and canonical links say about its own host. Null when nothing says.
function servedOverHttps(site) {
  if (schemes.has(site)) return schemes.get(site);
  let answer = null;
  if (site.config.site.url) {
    answer = new URL(site.config.site.url).protocol === "https:";
  } else {
    let secure = 0;
    let plain = 0;
    const urls = [...site.sitemaps.entries.map((entry) => entry.url), ...site.pages.map((page) => page.canonicalHref).filter(Boolean)];
    for (const text of urls) {
      try {
        const url = new URL(text);
        if (!site.isOwnHost(url.hostname)) continue;
        if (url.protocol === "https:") secure += 1;
        else if (url.protocol === "http:") plain += 1;
      } catch {
        // Not a URL; the sitemap and canonical rules say so.
      }
    }
    if (secure + plain > 0) answer = secure > plain;
  }
  schemes.set(site, answer);
  return answer;
}

// The host of an insecure URL that a browser would treat as mixed content, or null. Local
// addresses count as secure to browsers.
function insecureHost(url) {
  const text = url.trim();
  if (!/^http:\/\//i.test(text)) return null;
  try {
    const { hostname } = new URL(text);
    return isLocalHost(hostname) ? null : hostname;
  } catch {
    return null;
  }
}

const mixedContent = {
  id: "assets/mixed-content",
  severity: "error",
  description: "An HTTPS site loads a script, stylesheet, image or other subresource over plain http:.",
  page(page, { site, report }) {
    if (servedOverHttps(site) !== true) return;
    for (const { element, url } of pageSubresources(page)) {
      if (insecureHost(url)) {
        report({ file: page.file, offset: element.start, message: `Loads ${url.trim()} over plain HTTP on an HTTPS site, which browsers block or rewrite. Use https:` });
      }
    }
  },
  stylesheet(source, { site, report }) {
    if (servedOverHttps(site) !== true) return;
    const check = (url, offset) => {
      if (insecureHost(url)) {
        report({ file: source.file, offset: source.baseOffset + offset, message: `CSS loads ${url.trim()} over plain HTTP on an HTTPS site, which browsers block or rewrite. Use https:` });
      }
    };
    for (const declaration of source.declarations) {
      for (const { url, index } of findUrls(declaration.value)) check(url, declaration.valueOffset + index);
    }
    for (const statement of source.statements) {
      if (statement.name !== "import") continue;
      const target = importTarget(statement);
      if (target) check(target, statement.offset);
    }
  },
};

export const assetRules = [
  largeImage, largeStylesheet, largeScript, duplicateFile,
  imgMissingDimensions, oversizedImage, pageWeight, renderBlockingScript, fontDisplay, mixedContent,
];
