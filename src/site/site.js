// The built site as a whole: its files, parsed pages and stylesheets, and how a URL path maps
// to a file once deployed.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Page } from "../html/page.js";
import { getAttr } from "../html/tree.js";
import { scanCss } from "../css/scanner.js";
import { Suppressions, parseDirective, suppressionsFromText } from "../engine/suppressions.js";
import { LineIndex } from "./lines.js";
import { makeMatcher } from "./glob.js";
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

    const ignored = makeMatcher(config.ignore);
    this.pages = [];
    this.pagesByFile = new Map();
    this.stylesheets = [];
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
        const page = new Page(file, readText(root, file));
        this.pages.push(page);
        this.pagesByFile.set(file, page);
      } else if (STYLESHEET_FILE.test(file)) {
        const source = readText(root, file);
        const sheet = { file, kind: "file", baseOffset: 0, ...scanCss(source) };
        this.stylesheets.push(sheet);
        this.lineIndexes.set(file, new LineIndex(source));
        this.suppressionsByFile.set(file, this.stylesheetSuppressions(sheet));
      }
    }

    if (!this.ownHost) this.ownHost = this.inferOwnHost();
    if (!config.site.basePath && !configuredUrl) this.basePath = this.inferBasePath();
    for (const page of this.pages) {
      const base = page.first("base");
      page.baseUrl = baseUrlForFile(page.file, this, base ? getAttr(base, "href") : null);
    }
  }

  stylesheetSuppressions(sheet) {
    const suppressions = new Suppressions();
    const lines = this.lineIndexes.get(sheet.file);
    for (const comment of sheet.comments) {
      const directive = parseDirective(comment.text);
      if (!directive) continue;
      if (directive.kind === "file") suppressions.addFile(directive.rules);
      else if (directive.kind === "next-line") suppressions.addLine(lines.locate(comment.end).line + 1, directive.rules);
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
        if (href) count(href);
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
    const redirect = matchRedirect(this.redirects, `/${path}`);
    if (redirect) return { redirect };
    if (this.externalPath(`/${path}`)) return { external: true };
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
