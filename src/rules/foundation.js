// Rules about the files every public site should ship: robots.txt, llms.txt, a sitemap that
// matches the build, and a social sharing image of the right size.

import { getAttr } from "../html/tree.js";
import { makeMatcher } from "../site/glob.js";
import { hasCanonicalElsewhere, isIndexable, isNoindex, isRedirectPage } from "../site/classify.js";
import { checkAccess, namesCrawler } from "../site/robots.js";
import { fileForSitemapUrl } from "../site/sitemap.js";
import { isLocalHost } from "../site/site.js";
import { resolveReference } from "../site/urls.js";

const ROBOTS = "robots.txt";
const LLMS = "llms.txt";
const DEFAULT_CRAWLERS = [
  "GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot", "Google-Extended",
  "Bytespider", "CCBot", "Applebot-Extended", "cohere-ai", "anthropic-ai",
];

const robotsMissing = {
  id: "foundation/robots-missing",
  severity: "error",
  description: "The build has no robots.txt at its root.",
  site({ site, report }) {
    if (!site.robots) report({ file: ROBOTS, message: "No robots.txt at the root of the build" });
  },
};

const robotsBlocksCrawler = {
  id: "foundation/robots-blocks-crawler",
  severity: "error",
  description: "robots.txt blocks a crawler from the home page, or does not name it when requireExplicit is set.",
  options: { crawlers: DEFAULT_CRAWLERS, requireExplicit: false },
  site({ site, options, report }) {
    if (!site.robots) return;
    for (const crawler of options.crawlers) {
      const { allowed, rule } = checkAccess(site.robots, crawler, "/");
      if (!allowed) {
        report({
          file: ROBOTS,
          line: rule.line,
          message: `robots.txt blocks ${crawler} from the site ("Disallow: ${rule.path}")`,
        });
      } else if (options.requireExplicit && !namesCrawler(site.robots, crawler)) {
        report({ file: ROBOTS, message: `robots.txt has no User-agent group naming ${crawler}` });
      }
    }
  },
};

const robotsSitemap = {
  id: "foundation/robots-sitemap",
  severity: "warning",
  description: "robots.txt names no sitemap, or names one that is not in the build.",
  site({ site, report }) {
    if (!site.robots) return;
    if (site.robots.sitemaps.length === 0) {
      report({ file: ROBOTS, message: "robots.txt has no Sitemap line" });
      return;
    }
    for (const { url, line } of site.robots.sitemaps) {
      let parsed = null;
      try {
        parsed = new URL(url);
      } catch {
        report({ file: ROBOTS, line, message: `Sitemap line is not an absolute URL: ${url}` });
        continue;
      }
      if (isLocalHost(parsed.hostname)) {
        report({ file: ROBOTS, line, message: `Sitemap line points at a local address: ${url}` });
      } else if (site.isOwnHost(parsed.hostname) && !fileForSitemapUrl(site, url)) {
        report({ file: ROBOTS, line, message: `Sitemap line names ${url}, which is not in the build` });
      }
    }
  },
};

const llmsMissing = {
  id: "foundation/llms-txt-missing",
  severity: "warning",
  description: "The build has no llms.txt at its root.",
  site({ site, report }) {
    if (!site.hasFile(LLMS)) report({ file: LLMS, message: "No llms.txt at the root of the build" });
  },
};

const llmsInvalid = {
  id: "foundation/llms-txt-invalid",
  severity: "warning",
  description: "llms.txt is empty or does not begin with a Markdown title line.",
  site({ site, report }) {
    if (!site.hasFile(LLMS)) return;
    const lines = site.readText(LLMS).split("\n");
    const index = lines.findIndex((line) => line.trim() !== "");
    if (index === -1) report({ file: LLMS, message: "llms.txt is empty" });
    else if (!/^#\s+\S/.test(lines[index])) {
      report({ file: LLMS, line: index + 1, message: 'llms.txt should begin with a title line such as "# Site name"' });
    }
  },
};

const sitemapMissing = {
  id: "foundation/sitemap-missing",
  severity: "error",
  description: "No sitemap was found at the configured paths or in robots.txt.",
  site({ site, report }) {
    if (site.sitemaps.files.length > 0) return;
    const expected = site.config.site.sitemapPaths[0] ?? "sitemap.xml";
    report({ file: expected, message: `No sitemap found (looked for ${site.config.site.sitemapPaths.join(", ")})` });
  },
};

const sitemapInvalid = {
  id: "foundation/sitemap-invalid",
  severity: "error",
  description: "A sitemap cannot be read, lists nothing, or holds an entry that is not an absolute URL.",
  site({ site, report }) {
    for (const problem of site.sitemaps.problems) {
      report({ file: problem.file, offset: problem.offset, message: problem.message });
    }
  },
};

function entryPath(entry, site) {
  try {
    return site.stripBasePath(decodeURIComponent(new URL(entry.url).pathname));
  } catch {
    return null;
  }
}

const sitemapStaleUrl = {
  id: "foundation/sitemap-stale-url",
  severity: "error",
  description: "The sitemap lists a URL with no built page behind it.",
  site({ site, report }) {
    for (const entry of site.sitemaps.entries) {
      const path = entryPath(entry, site);
      if (path === null) continue;
      const target = site.lookup(path);
      if (target?.file || target?.external) continue;
      const message = target?.redirect
        ? `Sitemap lists ${entry.url}, which only redirects (to ${target.redirect.target})`
        : `Sitemap lists ${entry.url}, but the build has no page there`;
      report({ file: entry.file, offset: entry.offset, message });
    }
  },
};

const sitemapHost = {
  id: "foundation/sitemap-host",
  severity: "error",
  description: "A sitemap URL points at a local address or at a different host from the site.",
  site({ site, report }) {
    for (const entry of site.sitemaps.entries) {
      let hostname;
      try {
        hostname = new URL(entry.url).hostname;
      } catch {
        continue;
      }
      if (isLocalHost(hostname)) {
        report({ file: entry.file, offset: entry.offset, message: `Sitemap URL points at a local address: ${entry.url}` });
      } else if (site.ownHost && !site.isOwnHost(hostname)) {
        report({
          file: entry.file,
          offset: entry.offset,
          message: `Sitemap URL ${entry.url} is not on the site host (${site.ownHost})`,
        });
      }
    }
  },
};

const sitemapNoindexUrl = {
  id: "foundation/sitemap-noindex-url",
  severity: "warning",
  description: "The sitemap lists a page that asks not to be indexed or only redirects.",
  site({ site, report }) {
    for (const entry of site.sitemaps.entries) {
      const path = entryPath(entry, site);
      if (path === null) continue;
      const file = site.lookup(path)?.file;
      const page = file ? site.page(file) : null;
      if (!page) continue;
      if (isNoindex(page)) {
        report({ file: entry.file, offset: entry.offset, message: `Sitemap lists ${entry.url}, but that page is marked noindex` });
      } else if (isRedirectPage(page)) {
        report({ file: entry.file, offset: entry.offset, message: `Sitemap lists ${entry.url}, but that page only redirects` });
      }
    }
  },
};

const sitemapMissingPage = {
  id: "foundation/sitemap-missing-page",
  severity: "warning",
  description: "An indexable page is missing from the sitemap.",
  options: { exclude: [] },
  site({ site, options, report }) {
    if (site.sitemaps.entries.length === 0) return;
    const excluded = makeMatcher(options.exclude);
    const listed = new Set();
    for (const entry of site.sitemaps.entries) {
      const path = entryPath(entry, site);
      const file = path === null ? null : site.lookup(path)?.file;
      if (file) listed.add(file);
    }
    for (const page of site.pages) {
      if (listed.has(page.file) || !isIndexable(page) || excluded(page.file)) continue;
      if (hasCanonicalElsewhere(page, site)) continue;
      report({ file: page.file, message: "Page is not listed in the sitemap" });
    }
  },
};

// ---- Social images

const IMAGE_KEYS = ["og:image", "og:image:url", "og:image:secure_url"];
const ALL_IMAGE_KEYS = [...IMAGE_KEYS, "twitter:image", "twitter:image:src"];

function imageReferences(page, keys, site) {
  const references = [];
  for (const key of keys) {
    for (const meta of page.metaElements(key)) {
      const content = getAttr(meta, "content");
      if (content === null || content.trim() === "") continue;
      references.push({ meta, content, resolved: resolveReference(content, page.baseUrl, site) });
    }
  }
  return references;
}

const defaultImages = new WeakMap();

// The site-wide sharing image: the first configured path that exists, or else the local
// image most pages name. `external` is true when pages only name images on other hosts.
function findDefaultImage(site) {
  if (defaultImages.has(site)) return defaultImages.get(site);
  let result = null;
  const configured = site.config.site.socialImagePaths.find((path) => site.hasFile(path));
  if (configured) {
    result = { file: configured };
  } else {
    const counts = new Map();
    let external = false;
    for (const page of site.pages) {
      for (const { resolved } of imageReferences(page, IMAGE_KEYS, site)) {
        if (resolved.kind === "external") external = true;
        if (resolved.kind !== "internal") continue;
        const file = site.lookup(resolved.path)?.file;
        if (file) counts.set(file, (counts.get(file) ?? 0) + 1);
      }
    }
    const best = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best) result = { file: best[0] };
    else if (external) result = { external: true };
  }
  defaultImages.set(site, result);
  return result;
}

const socialImageMissing = {
  id: "foundation/social-image-missing",
  severity: "error",
  description: "The build has no default social sharing image.",
  site({ site, report }) {
    if (findDefaultImage(site)) return;
    const expected = site.config.site.socialImagePaths[0] ?? "og-default.png";
    report({ file: expected, message: `No default social image found (expected ${expected} or a page naming a local og:image)` });
  },
};

const socialImageSize = {
  id: "foundation/social-image-size",
  severity: "error",
  description: "The default social image is not the configured size, 1200 by 630 by default.",
  options: { width: 1200, height: 630 },
  site({ site, options, report }) {
    const image = findDefaultImage(site);
    if (!image?.file) return;
    const size = site.imageSize(image.file);
    if (!size) {
      report({ file: image.file, message: "Cannot read the size of the default social image: it is not a valid PNG or JPEG" });
    } else if (size.width !== options.width || size.height !== options.height) {
      report({
        file: image.file,
        message: `Default social image is ${size.width}x${size.height}, expected ${options.width}x${options.height}`,
      });
    }
  },
};

const pageSocialImage = {
  id: "foundation/page-social-image",
  severity: "warning",
  description: "An indexable page has no og:image, so shares of it show no picture.",
  page(page, { site, report }) {
    if (!isIndexable(page)) return;
    if (imageReferences(page, IMAGE_KEYS, site).length === 0) {
      report({ file: page.file, message: "Page has no og:image meta tag" });
    }
  },
};

const pageSocialImageBroken = {
  id: "foundation/page-social-image-broken",
  severity: "error",
  description: "A page names a social image that is not in the build.",
  page(page, { site, report }) {
    if (isRedirectPage(page)) return;
    for (const { meta, content, resolved } of imageReferences(page, ALL_IMAGE_KEYS, site)) {
      if (resolved.kind === "internal" && site.lookup(resolved.path) === null) {
        report({ file: page.file, offset: meta.start, message: `Social image ${content} is not in the build` });
      }
    }
  },
};

const pageSocialImageSize = {
  id: "foundation/page-social-image-size",
  severity: "warning",
  description: "A page names its own PNG or JPEG social image at a size other than the configured one.",
  options: { width: 1200, height: 630 },
  page(page, { site, options, report }) {
    if (!isIndexable(page)) return;
    const defaultFile = findDefaultImage(site)?.file;
    for (const { meta, content, resolved } of imageReferences(page, IMAGE_KEYS, site)) {
      if (resolved.kind !== "internal") continue;
      const file = site.lookup(resolved.path)?.file;
      if (!file || file === defaultFile) continue;
      const size = site.imageSize(file);
      if (size && (size.width !== options.width || size.height !== options.height)) {
        report({
          file: page.file,
          offset: meta.start,
          message: `Social image ${content} is ${size.width}x${size.height}, expected ${options.width}x${options.height}`,
        });
      }
    }
  },
};

export const foundationRules = [
  robotsMissing, robotsBlocksCrawler, robotsSitemap,
  llmsMissing, llmsInvalid,
  sitemapMissing, sitemapInvalid, sitemapStaleUrl, sitemapHost, sitemapNoindexUrl, sitemapMissingPage,
  socialImageMissing, socialImageSize, pageSocialImage, pageSocialImageBroken, pageSocialImageSize,
];
