// Page classifications shared by rules: which pages are real, indexable content, and which
// are error pages, redirects or pages that opted out of indexing.

import { getAttr } from "../html/tree.js";
import { resolveReference } from "./urls.js";

const ERROR_PAGE = /(?:^|\/)(?:404|500|not-found|error)(?:\/index)?\.html?$/i;
const VERIFICATION_PAGE = /(?:^|\/)(?:google[0-9a-f]+|yandex_[0-9a-f]+|BingSiteAuth)\.html?$/i;

export function isErrorPage(page) {
  return ERROR_PAGE.test(page.file);
}

export function isNoindex(page) {
  return ["robots", "googlebot"].some((name) =>
    page.metaElements(name).some((meta) => /\b(noindex|none)\b/i.test(getAttr(meta, "content") ?? "")),
  );
}

export function isRedirectPage(page) {
  // A refresh with no URL reloads the same page, which is not a redirect.
  return page.all("meta").some(
    (meta) => (getAttr(meta, "http-equiv") ?? "").trim().toLowerCase() === "refresh" && /url\s*=/i.test(getAttr(meta, "content") ?? ""),
  );
}

export function isIndexable(page) {
  if (isErrorPage(page) || isNoindex(page) || isRedirectPage(page) || VERIFICATION_PAGE.test(page.file)) return false;
  return !(page.site && hasCanonicalElsewhere(page, page.site));
}

// True when the canonical link of a page names a different page.
export function hasCanonicalElsewhere(page, site) {
  const canonical = page.all("link").find((link) => (getAttr(link, "rel") ?? "").trim().toLowerCase() === "canonical");
  const href = canonical ? getAttr(canonical, "href") : null;
  if (!href) return false;
  const resolved = resolveReference(href, page.baseUrl, site);
  if (resolved.kind === "external") return true;
  if (resolved.kind !== "internal") return false;
  const target = site.lookup(resolved.path);
  return Boolean(target && target.file && target.file !== page.file);
}
