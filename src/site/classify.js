// Page classifications shared by rules: which pages are real, indexable content, and which
// are error pages, redirects or pages that opted out of indexing. Each takes a page or the
// summary the site keeps of one.

import { resolveReference } from "./urls.js";

// Error pages, and the empty shells single page applications fall back to.
const ERROR_PAGE = /(?:^|\/)(?:404|500|200|fallback|_?not-found|_?error)(?:\/index)?\.html?$/i;
const VERIFICATION_PAGE = /(?:^|\/)(?:google[0-9a-f]+|yandex_[0-9a-f]+|BingSiteAuth)\.html?$/i;

export function isErrorPage(page) {
  return ERROR_PAGE.test(page.file);
}

export function isNoindex(page) {
  return page.noindex;
}

export function isRedirectPage(page) {
  return page.redirect;
}

export function isIndexable(page) {
  if (isErrorPage(page) || isNoindex(page) || isRedirectPage(page) || VERIFICATION_PAGE.test(page.file)) return false;
  return !(page.site && hasCanonicalElsewhere(page, page.site));
}

// True when the canonical link of a page names a different page.
export function hasCanonicalElsewhere(page, site) {
  const href = page.canonicalHref;
  if (!href) return false;
  const resolved = resolveReference(href, page.baseUrl, site);
  if (resolved.kind === "external") return true;
  if (resolved.kind !== "internal") return false;
  const target = site.lookup(resolved.path);
  return Boolean(target && target.file && target.file !== page.file);
}
