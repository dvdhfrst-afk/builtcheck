// The built site as a whole: its files, stylesheets and a summary of each page, and how a URL
// path maps to a file once deployed. Memory stays flat however many pages there are: the first
// pass over the pages keeps a summary of each and works out which CSS selectors are in use, and
// the rules then run in a second pass that holds one parsed page at a time.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { Page } from "../html/page.js";
import { getAttr } from "../html/tree.js";
import { nextRuleEnd, scanCss } from "../css/scanner.js";
import { PageStyles } from "../css/cascade.js";
import { parseSelectorList, resolveNesting } from "../css/selectors.js";
import { SelectorUse } from "../css/selector-use.js";
import { Suppressions, parseDirective, suppressionsFromText } from "../engine/suppressions.js";
import { LineIndex } from "./lines.js";
import { expandFileGlob, makeMatcher } from "./glob.js";
import { parseRobots } from "./robots.js";
import { parseRedirects, matchRedirect } from "./redirects.js";
import { loadSitemaps } from "./sitemap.js";
import { baseUrlForFile } from "./urls.js";
import { readImageSize } from "./images.js";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const NO_SUPPRESSIONS = new Suppressions();
const MAX_SAMPLED_PATHS = 2000;
const PAGE_FILE = /\.html?$/i;
const STYLESHEET_FILE = /\.css$/i;

// A file this large is not hand-written HTML or CSS, and a parsed tree of it would not fit in memory.
export const MAX_TEXT_BYTES = 32 * 1024 * 1024;

function describeReadError(error) {
  if (error.code === "EACCES" || error.code === "EPERM") return "permission denied";
  if (error.code === "EBUSY") return "the file is locked by another program";
  if (error.code === "ENOENT") return "the file disappeared during the run";
  if (error.code === "EMFILE" || error.code === "ENFILE") return "too many files are open";
  return error.code ?? error.message;
}

function isInside(folder, path) {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);
}

// Lists the build. A symbolic link is followed only while it stays inside the site folder, so
// auditing a folder never reads anything outside it. Result: { files, outside }, where `outside`
// holds links to files elsewhere, which exist for link checks but are not opened.
function listFiles(root, skip) {
  const files = [];
  const outside = new Set();
  const realRoot = realpathSync(root);
  const visited = new Set([realRoot]);
  const pending = [""];
  while (pending.length > 0) {
    const relative = pending.pop();
    let entries;
    try {
      entries = readdirSync(join(root, relative), { withFileTypes: true });
    } catch (error) {
      if (relative === "") throw error;
      skip(relative, `could not list this folder: ${describeReadError(error)}`, true);
      continue;
    }
    for (const entry of entries) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        // Only a link can lead back to a folder, but a real folder can still be a link's target.
        const real = realpathSync(join(root, path));
        if (!visited.has(real)) {
          visited.add(real);
          pending.push(path);
        }
      } else if (entry.isFile()) {
        files.push(path);
      } else if (entry.isSymbolicLink()) {
        let real;
        let stats;
        try {
          real = realpathSync(join(root, path));
          stats = statSync(real);
        } catch {
          skip(path, "broken symbolic link");
          continue;
        }
        if (!isInside(realRoot, real)) {
          if (stats.isFile()) outside.add(path);
          skip(path, "symbolic link to something outside the site folder, so it was not read");
          if (stats.isFile()) files.push(path);
        } else if (stats.isDirectory()) {
          if (!visited.has(real)) {
            visited.add(real);
            pending.push(path);
          }
        } else if (stats.isFile()) {
          files.push(path);
        }
      }
    }
  }
  return { files: files.sort(), outside };
}

function decodeBom(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString("utf16le").replace(/^\ufeff/, "");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be").decode(buffer).replace(/^\ufeff/, "");
  return null;
}

// Pages are UTF-8 nearly always, but a page may declare otherwise and bytes must decode to the
// same characters a browser would see.
function decodePage(buffer) {
  const marked = decodeBom(buffer);
  if (marked !== null) return marked;
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

function decodeText(buffer) {
  return decodeBom(buffer) ?? buffer.toString("utf8").replace(/^\ufeff/, "");
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
    // Files the audit could not cover: [{ file, reason, incomplete }]. "Incomplete" means something
    // went wrong rather than a file being left out on purpose.
    this.skipped = [];
    const listed = listFiles(root, (file, reason, incomplete = false) => this.skip(file, reason, incomplete));
    this.files = new Set(listed.files);
    this.outsideFiles = listed.outside;
    this.lowerCaseFiles = new Map();
    for (const file of this.files) this.lowerCaseFiles.set(file.toLowerCase(), file);

    this.ignored = makeMatcher(config.ignore.flatMap(expandFileGlob));
    this.pages = [];
    this.pagesByFile = new Map();
    this.stylesheets = [];
    this.stylesheetsByFile = new Map();
    this.lineIndexes = new Map();
    this.suppressionsByFile = new Map();
    this.externalPath = makeMatcher(config.site.externalPaths);
    this.currentPage = null;

    this.basePath = normalizeBasePath(config.site.basePath);
    this.ownHost = null;
    const configuredUrl = config.site.url;
    if (configuredUrl) {
      const url = new URL(configuredUrl);
      this.ownHost = comparableHost(url.hostname);
      if (!config.site.basePath) this.basePath = normalizeBasePath(url.pathname);
    }

    const redirects = this.hasFile("_redirects") ? this.readText("_redirects") : null;
    this.redirects = redirects === null ? [] : parseRedirects(redirects);
    const robots = this.hasFile("robots.txt") ? this.readText("robots.txt") : null;
    this.robots = robots === null ? null : parseRobots(robots);
    this.sitemaps = loadSitemaps(this, config.site.sitemapPaths, this.robots);

    for (const file of this.files) {
      if (!STYLESHEET_FILE.test(file) || this.ignored(file)) continue;
      const source = this.readText(file);
      if (source === null) continue;
      const sheet = { file, kind: "file", baseOffset: 0, ...scanCss(source) };
      this.stylesheets.push(sheet);
      this.stylesheetsByFile.set(file, sheet);
      this.lineIndexes.set(file, new LineIndex(source));
      this.suppressionsByFile.set(file, this.stylesheetSuppressions(sheet, source));
    }

    this.selectorUse = new SelectorUse(this.stylesheets);
    this.sampledPaths = [];
    for (const file of this.files) {
      if (!PAGE_FILE.test(file) || this.ignored(file)) continue;
      const page = this.parsePage(file);
      if (!page) continue;
      this.sampleRootRelativePaths(page);
      const summary = page.summary();
      summary.site = this;
      this.pages.push(summary);
      this.pagesByFile.set(file, summary);
      this.selectorUse.visit(page);
    }

    if (!this.ownHost) this.ownHost = this.inferOwnHost();
    if (!config.site.basePath && this.basePath === "") this.basePath = this.inferBasePath() || this.inferBasePathFromReferences();
    this.outsideBasePath = this.countOutsideBasePath();
    this.sampledPaths = null;
    for (const summary of this.pages) {
      summary.ownUrl = baseUrlForFile(summary.file, this);
      summary.baseUrl = baseUrlForFile(summary.file, this, summary.baseHref);
    }
  }

  skip(file, reason, incomplete = false) {
    this.skipped.push({ file, reason, incomplete });
  }

  // Reads a file, or records why it could not be read and returns null.
  readBounded(file, limit = MAX_TEXT_BYTES) {
    if (this.outsideFiles.has(file)) return null;
    const path = join(this.root, file);
    try {
      if (statSync(path).size > limit) {
        this.skip(file, `larger than ${Math.round(limit / (1024 * 1024))} MiB, so it was not read. Add it to "ignore" in the config to leave it out on purpose`, true);
        return null;
      }
      return readFileSync(path);
    } catch (error) {
      this.skip(file, `could not be read: ${describeReadError(error)}`, true);
      return null;
    }
  }

  parsePage(file) {
    const buffer = this.readBounded(file);
    return buffer === null ? null : new Page(file, decodePage(buffer));
  }

  // The pages one at a time, fully parsed and connected to their stylesheets. Only one is held
  // at a time, so rules that need something from another page ask for its summary.
  *eachPage() {
    for (const summary of this.pages) {
      const page = this.parsePage(summary.file);
      if (!page) continue;
      page.site = this;
      page.ownUrl = summary.ownUrl;
      page.baseUrl = summary.baseUrl;
      page.applyStyles(new PageStyles(page, this));
      this.currentPage = page;
      yield page;
    }
    this.currentPage = null;
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
      for (const { canonicalHref: href } of this.pages) {
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

  // Paths such as /docs/_next/app.js from the first pages, for inferring a base path.
  sampleRootRelativePaths(page) {
    if (this.sampledPaths.length >= MAX_SAMPLED_PATHS) return;
    const attributes = [["a", "href"], ["link", "href"], ["script", "src"], ["img", "src"]];
    for (const [name, attribute] of attributes) {
      for (const element of page.all(name)) {
        const value = getAttr(element, attribute);
        if (!value || !value.startsWith("/") || value.startsWith("//")) continue;
        try {
          this.sampledPaths.push(decodeURIComponent(new URL(value, "http://builtcheck.invalid/").pathname));
        } catch {
          // A malformed reference says nothing here, and the link rules report it.
        }
      }
    }
  }

  // How many of the sampled references fall outside the base path, and so go unchecked.
  countOutsideBasePath() {
    if (this.basePath === "") return { outside: 0, total: 0 };
    const outside = this.sampledPaths.filter((path) => path !== this.basePath && !path.startsWith(`${this.basePath}/`) && !this.externalPath(path));
    return { outside: outside.length, total: this.sampledPaths.length };
  }

  // A build with no sitemap can still show its base path: when most root-relative references
  // miss, all under one folder that is not in the build, and removing that folder finds them.
  inferBasePathFromReferences() {
    if (this.sitemaps.entries.length > 0) return "";
    const missing = this.sampledPaths.filter((path) => this.lookup(path) === null);
    const counts = new Map();
    for (const path of missing) {
      const first = path.split("/")[1];
      if (first) counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    const [best] = [...counts].sort((a, b) => b[1] - a[1]);
    if (!best || best[1] < 2 || best[1] < missing.length * 0.8) return "";
    const [folder] = best;
    const prefix = `/${folder}`;
    for (const file of this.files) {
      if (file.startsWith(`${folder}/`)) return "";
    }
    const under = missing.filter((path) => path === prefix || path.startsWith(`${prefix}/`));
    const found = under.filter((path) => this.lookup(path.slice(prefix.length) || "/") !== null).length;
    return found >= under.length * 0.8 ? prefix : "";
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

  // Bytes for a file up to the limit, or null if it could not be read.
  readBuffer(file, limit = MAX_TEXT_BYTES) {
    return this.readBounded(file, limit);
  }

  readText(file) {
    const buffer = this.readBounded(file);
    return buffer === null ? null : decodeText(buffer);
  }

  // Width and height, null if the bytes are not a readable PNG or JPEG, or undefined if the file
  // could not be read at all.
  imageSize(file) {
    const buffer = this.readBounded(file, 1024 * 1024 * 1024);
    return buffer === null ? undefined : readImageSize(buffer);
  }

  // The summary of a page: its file, ids and classification. See Page.summary().
  page(file) {
    return this.pagesByFile.get(file) ?? null;
  }

  stylesheet(file) {
    return this.stylesheetsByFile.get(file) ?? null;
  }

  // Whether a selector, as a chain of nested selector lists, could match anything. A rule with no
  // selector, such as an inline style or @font-face, always counts. A <style> block answers for
  // its own page and a stylesheet file for the whole build.
  selectorInUse(selectorPath, source = null) {
    if (selectorPath.length === 0) return true;
    const text = resolveNesting(selectorPath);
    if (source?.page) {
      return parseSelectorList(text).some((complex) => complex.unparsed || complex.unknownPseudo || source.page.matching(complex, 1).length > 0);
    }
    return this.selectorUse.isUsed(text);
  }

  // The elements on one page that a selector could match, up to a limit. Selectors this tool
  // cannot judge match nothing here.
  matchingElements(page, selectorPath, limit = 50) {
    const found = [];
    for (const complex of parseSelectorList(resolveNesting(selectorPath))) {
      if (complex.unparsed || complex.unknownPseudo) continue;
      found.push(...page.matching(complex, limit - found.length));
      if (found.length >= limit) break;
    }
    return found;
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
    if (this.currentPage?.file === file) return this.currentPage.lines;
    if (this.pagesByFile.has(file)) return null;
    if (!this.lineIndexes.has(file)) {
      const text = this.files.has(file) && !file.endsWith(".gz") ? this.readText(file) : null;
      this.lineIndexes.set(file, text === null ? null : new LineIndex(text));
    }
    return this.lineIndexes.get(file);
  }

  suppressionsFor(file) {
    if (this.currentPage?.file === file) return this.currentPage.suppressions;
    const summary = this.pagesByFile.get(file);
    if (summary) return summary.suppressions ?? NO_SUPPRESSIONS;
    if (!this.suppressionsByFile.has(file)) {
      const text = this.files.has(file) && /(?:\.txt|\.xml|^_redirects)$/i.test(file) ? this.readText(file) : null;
      this.suppressionsByFile.set(file, text === null ? NO_SUPPRESSIONS : suppressionsFromText(text));
    }
    return this.suppressionsByFile.get(file);
  }
}
