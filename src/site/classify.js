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
  return page.all("meta").some((meta) => (getAttr(meta, "http-equiv") ?? "").trim().toLowerCase() === "refresh");
}

export function isIndexable(page) {
  return !(isErrorPage(page) || isNoindex(page) || isRedirectPage(page) || VERIFICATION_PAGE.test(page.file));
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
