// The built site as a whole: its files, parsed pages and stylesheets, and how a URL path maps
// to a file once deployed.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Page } from "../html/page.js";
import { getAttr } from "../html/tree.js";
import { nextRuleEnd, scanCss } from "../css/scanner.js";
import { PageStyles } from "../css/cascade.js";
import { matchesSelector, parseSelectorList, requiredNames, resolveNesting, selectorKey } from "../css/selectors.js";
import { Suppressions, parseDirective, suppressionsFromText } from "../engine/suppressions.js";
import { LineIndex } from "./lines.js";
import { expandFileGlob, makeMatcher } from "./glob.js";
import { parseRobots } from "./robots.js";
import { parseRedirects, matchRedirect } from "./redirects.js";
import { loadSitemaps } from "./sitemap.js";
import { baseUrlForFile } from "./urls.js";
import { readImageSize } from "./images.js";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const PAGE_FILE = /\.html?$/i;
const STYLESHEET_FILE = /\.css$/i;

function listFiles(root) {
  const files = [];
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop();
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return files.sort();
}

function readText(root, file) {
  return readFileSync(join(root, file), "utf8").replace(/^\ufeff/, "");
}

// Pages are UTF-8 nearly always, but a page may declare otherwise and bytes must decode to the
// same characters a browser would see.
function readPageText(root, file) {
  const buffer = readFileSync(join(root, file));
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le").replace(/^\ufeff/, "");
  const declared = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([\w-]+)/i.exec(buffer.toString("latin1", 0, 1024));
  if (declared && !/^utf-?8$/i.test(declared[1])) {
    try {
      return new TextDecoder(declared[1]).decode(buffer);
    } catch {
      // An unknown label: fall through to UTF-8, as the file most likely is.
    }
  }
  return buffer.toString("utf8").replace(/^\ufeff/, "");
}

function normalizeBasePath(value) {
  if (!value) return "";
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : `/${trimmed}`;
}

function comparableHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|.+\.local|.+\.localhost)$/i;

export function isLocalHost(hostname) {
  return LOCAL_HOST.test(hostname);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export class Site {
  constructor(root, config) {
    this.root = root;
    this.config = config;
    this.files = new Set(listFiles(root));
    this.lowerCaseFiles = new Map();
    for (const file of this.files) this.lowerCaseFiles.set(file.toLowerCase(), file);

    const ignored = makeMatcher(config.ignore.flatMap(expandFileGlob));
    this.pages = [];
    this.pagesByFile = new Map();
    this.stylesheets = [];
    this.stylesheetsByFile = new Map();
    this.selectorUse = new Map();
    this.elementNames = null;
    this.lineIndexes = new Map();
    this.suppressionsByFile = new Map();
    this.externalPath = makeMatcher(config.site.externalPaths);

    this.basePath = normalizeBasePath(config.site.basePath);
    this.ownHost = null;
    const configuredUrl = config.site.url;
    if (configuredUrl) {
      const url = new URL(configuredUrl);
      this.ownHost = comparableHost(url.hostname);
      if (!config.site.basePath) this.basePath = normalizeBasePath(url.pathname);
    }

    this.redirects = this.hasFile("_redirects") ? parseRedirects(readText(root, "_redirects")) : [];
    this.robots = this.hasFile("robots.txt") ? parseRobots(readText(root, "robots.txt")) : null;
    this.sitemaps = loadSitemaps(this, config.site.sitemapPaths, this.robots);

    for (const file of this.files) {
      if (ignored(file)) continue;
      if (PAGE_FILE.test(file)) {
        const page = new Page(file, readPageText(root, file));
        this.pages.push(page);
        this.pagesByFile.set(file, page);
      } else if (STYLESHEET_FILE.test(file)) {
        const source = readText(root, file);
        const sheet = { file, kind: "file", baseOffset: 0, ...scanCss(source) };
        this.stylesheets.push(sheet);
        this.stylesheetsByFile.set(file, sheet);
        this.lineIndexes.set(file, new LineIndex(source));
        this.suppressionsByFile.set(file, this.stylesheetSuppressions(sheet, source));
      }
    }

    if (!this.ownHost) this.ownHost = this.inferOwnHost();
    if (!config.site.basePath && this.basePath === "") this.basePath = this.inferBasePath();
    for (const page of this.pages) {
      page.site = this;
      page.ownUrl = baseUrlForFile(page.file, this);
      const base = page.first("base");
      page.baseUrl = baseUrlForFile(page.file, this, base ? getAttr(base, "href") : null);
    }
    for (const page of this.pages) page.applyStyles(new PageStyles(page, this));
  }

  stylesheetSuppressions(sheet, source) {
    const suppressions = new Suppressions();
    const lines = this.lineIndexes.get(sheet.file);
    for (const comment of sheet.comments) {
      const directive = parseDirective(comment.text);
      if (!directive) continue;
      if (directive.kind === "file") suppressions.addFile(directive.rules);
      else if (directive.kind === "next-line") suppressions.addNextLine(source, comment.end, lines, directive.rules);
      else suppressions.addRange(comment.end, nextRuleEnd(source, comment.end), directive.rules);
    }
    return suppressions;
  }

  // Without a configured URL, the own host of the site is the one its sitemap and robots.txt
  // use most, then whatever its pages declare as canonical. Absolute links to it are internal.
  inferOwnHost() {
    const counts = new Map();
    const count = (url) => {
      const host = hostOf(url);
      if (host && !isLocalHost(host)) {
        const key = comparableHost(host);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    };
    for (const entry of this.sitemaps.entries) count(entry.url);
    if (counts.size === 0 && this.robots) {
      for (const sitemap of this.robots.sitemaps) count(sitemap.url);
    }
    if (counts.size === 0) {
      for (const page of this.pages) {
        const canonical = page.all("link").find((link) => (getAttr(link, "rel") ?? "").toLowerCase() === "canonical");
        const href = canonical ? getAttr(canonical, "href") : null;
        // A canonical can name another site entirely, as with a post republished from elsewhere.
        // It says something about this host only if the path it names is in this build.
        if (href && this.isBuiltPath(href)) count(href);
      }
    }
    let best = null;
    let bestCount = 0;
    for (const [host, total] of counts) {
      if (total > bestCount) {
        best = host;
        bestCount = total;
      }
    }
    return best;
  }

  // A site deployed under a subpath lists sitemap URLs like /docs/about/ while its files sit
  // at about/index.html. If every sitemap URL shares a leading path that does not exist as a
  // folder in the build, and removing it finds the pages, that leading path is the base path.
  // One URL is not evidence: a lone stale entry would read as a base path and hide itself.
  inferBasePath() {
    const unique = new Set();
    for (const entry of this.sitemaps.entries) {
      try {
        unique.add(decodeURIComponent(new URL(entry.url).pathname));
      } catch {
        return "";
      }
    }
    const paths = [...unique];
    if (paths.length < 2) return "";
    const split = paths.map((path) => path.split("/").filter(Boolean));
    let common = 0;
    while (split.every((parts) => parts.length > common && parts[common] === split[0][common])) common += 1;
    if (common === 0) return "";
    const first = `${split[0][0]}/`;
    for (const file of this.files) {
      if (file.startsWith(first)) return "";
    }
    const prefix = `/${split[0].slice(0, common).join("/")}`;
    const found = paths.filter((path) => this.lookup(path.slice(prefix.length) || "/")?.file).length;
    return found * 2 >= paths.length ? prefix : "";
  }

  isBuiltPath(url) {
    try {
      return Boolean(this.lookup(decodeURIComponent(new URL(url).pathname))?.file);
    } catch {
      return false;
    }
  }

  isOwnHost(hostname) {
    return this.ownHost !== null && comparableHost(hostname) === this.ownHost;
  }

  // Removes the base path from a URL path. Returns null if the path lies outside it.
  stripBasePath(pathname) {
    if (this.basePath === "") return pathname;
    if (pathname === this.basePath) return "/";
    return pathname.startsWith(`${this.basePath}/`) ? pathname.slice(this.basePath.length) : null;
  }

  hasFile(file) {
    return this.files.has(file);
  }

  readBuffer(file) {
    return readFileSync(join(this.root, file));
  }

  readText(file) {
    return readText(this.root, file);
  }

  imageSize(file) {
    return readImageSize(this.readBuffer(file));
  }

  page(file) {
    return this.pagesByFile.get(file) ?? null;
  }

  stylesheet(file) {
    return this.stylesheetsByFile.get(file) ?? null;
  }

  // Every tag, "#id" and ".class" on any page, to rule out most unused selectors at once.
  namesInBuild() {
    if (this.elementNames) return this.elementNames;
    const names = new Map();
    const add = (key, page, element) => {
      if (!names.has(key)) names.set(key, new Map());
      const byPage = names.get(key);
      if (!byPage.has(page)) byPage.set(page, []);
      byPage.get(page).push(element);
    };
    for (const page of this.pages) {
      for (const element of page.elements) {
        add(element.name, page, element);
        const id = getAttr(element, "id");
        if (id) add(`#${id}`, page, element);
        for (const name of (getAttr(element, "class") ?? "").split(/\s+/)) {
          if (name) add(`.${name}`, page, element);
        }
      }
    }
    this.elementNames = names;
    return names;
  }

  // Whether a selector, as a chain of nested selector lists, could match anything on any page.
  // A rule with no selector, such as an inline style or @font-face, always counts.
  selectorInUse(selectorPath) {
    if (selectorPath.length === 0) return true;
    const text = resolveNesting(selectorPath);
    if (this.selectorUse.has(text)) return this.selectorUse.get(text);
    const inUse = parseSelectorList(text).some((complex) => this.complexInUse(complex));
    this.selectorUse.set(text, inUse);
    return inUse;
  }

  // Up to `limit` elements a selector could match, each with its page. An empty list means
  // nothing in the build uses it, or the selector is one this tool cannot judge.
  matchingElements(selectorPath, limit = 50) {
    const found = [];
    for (const complex of parseSelectorList(resolveNesting(selectorPath))) {
      if (complex.unparsed || complex.unknownPseudo) continue;
      const key = selectorKey(complex);
      const groups = key === null
        ? this.pages.map((page) => [page, page.elements])
        : [...(this.namesInBuild().get(key) ?? new Map())];
      for (const [page, elements] of groups) {
        for (const element of elements) {
          if (found.length >= limit) return found;
          if (matchesSelector(element, complex)) found.push({ page, element });
        }
      }
    }
    return found;
  }

  complexInUse(complex) {
    // A selector this tool cannot read, or a pseudo-class it does not know, gets the benefit
    // of the doubt.
    if (complex.unparsed || complex.unknownPseudo) return true;
    const names = this.namesInBuild();
    // Every class and id a selector needs has to exist somewhere, which rules out most unused
    // CSS without visiting an element.
    if (requiredNames(complex).some((name) => !names.has(name))) return false;
    const key = selectorKey(complex);
    if (key === null) return this.pages.some((page) => page.elements.some((element) => matchesSelector(element, complex)));
    const byPage = names.get(key);
    if (!byPage) return false;
    for (const elements of byPage.values()) {
      if (elements.some((element) => matchesSelector(element, complex))) return true;
    }
    return false;
  }

  // Every place CSS lives: stylesheet files, <style> blocks and style attributes.
  get styleSources() {
    return [...this.stylesheets, ...this.pages.flatMap((page) => page.styleSources)];
  }

  // What a URL path serves once deployed. Result:
  //   { file }             a built file
  //   { redirect: rule }   a _redirects entry handles it
  //   { external: true }   configured as served by something other than this build
  //   null                 nothing: a broken link
  lookup(pathname) {
    const path = pathname.replace(/^\/+/, "");
    for (const candidate of this.candidates(path)) {
      if (this.files.has(candidate)) return { file: candidate };
    }
    // These are written as URL paths, so under a base path they may or may not include it.
    const forms = this.basePath === "" ? [`/${path}`] : [`/${path}`, `${this.basePath}/${path}`];
    for (const form of forms) {
      const redirect = matchRedirect(this.redirects, form);
      if (redirect) return { redirect };
      if (this.externalPath(form)) return { external: true };
    }
    return null;
  }

  candidates(path) {
    if (path === "" || path.endsWith("/")) {
      const bare = path.replace(/\/+$/, "");
      return [`${path}index.html`, `${path}index.htm`, ...(bare ? [`${bare}.html`, `${bare}.htm`] : [])];
    }
    return [path, `${path}.html`, `${path}.htm`, `${path}/index.html`, `${path}/index.htm`];
  }

  // The real name of a file when a path differs from it only by letter case. That works on a
  // laptop and breaks on most production hosts, so it deserves its own hint.
  caseMismatch(pathname) {
    const path = pathname.replace(/^\/+/, "");
    for (const candidate of this.candidates(path)) {
      const actual = this.lowerCaseFiles.get(candidate.toLowerCase());
      if (actual) return actual;
    }
    return null;
  }

  lineIndexFor(file) {
    const page = this.pagesByFile.get(file);
    if (page) return page.lines;
    if (!this.lineIndexes.has(file)) {
      const readable = this.files.has(file) && !file.endsWith(".gz");
      this.lineIndexes.set(file, readable ? new LineIndex(this.readText(file)) : null);
    }
    return this.lineIndexes.get(file);
  }

  suppressionsFor(file) {
    const page = this.pagesByFile.get(file);
    if (page) return page.suppressions;
    if (!this.suppressionsByFile.has(file)) {
      const isText = this.files.has(file) && /(?:\.txt|\.xml|^_redirects)$/i.test(file);
      this.suppressionsByFile.set(file, isText ? suppressionsFromText(this.readText(file)) : new Suppressions());
    }
    return this.suppressionsByFile.get(file);
  }
}
