// Documents that pages link to rather than show, such as feeds and web app manifests. Many pages
// link the same one, so a rule checks each document the first time a page links it and reports
// on the document itself, once.

import { getAttr } from "../html/tree.js";
import { resolveReference } from "../site/urls.js";
import { linkRels } from "./references.js";

const seen = new WeakMap();

// True the first time a rule asks about this key in a run. A rule's context object lives for the
// whole run, so it keys what that rule has already looked at.
export function firstTime(context, key) {
  if (!seen.has(context)) seen.set(context, new Set());
  const keys = seen.get(context);
  if (keys.has(key)) return false;
  keys.add(key);
  return true;
}

// The <link> elements on a page that `matches` accepts, with where each leads:
// [{ element, href, file, missing, path }]. `file` is the built file, `missing` is true when
// the link points into the build at nothing, and both are empty for other hosts and redirects.
export function linkedDocuments(page, site, matches) {
  const found = [];
  for (const element of page.all("link")) {
    if (page.isInTemplate(element) || !matches(element, linkRels(element))) continue;
    const href = getAttr(element, "href")?.trim();
    if (!href) continue;
    const resolved = resolveReference(href, page.baseUrl, site);
    if (resolved.kind !== "internal") continue;
    const target = site.lookup(resolved.path);
    found.push({ element, href, file: target?.file ?? null, missing: target === null, path: resolved.path });
  }
  return found;
}

// The address a built file is served at, as a reader of the report would type it.
export function servedPath(site, file) {
  return `${site.basePath}/${file}`;
}
