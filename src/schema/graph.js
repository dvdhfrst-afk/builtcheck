// How the nodes of one page connect through @id: which nodes define an @id, which only refer to
// one, and a key for each @id that is the same however the page spells it. Search engines merge
// every JSON-LD block on a page by @id, so the index covers all blocks together.

import { resolveReference } from "../site/urls.js";
import { isReferenceOnly } from "./jsonld.js";

// A key for an @id. "#org" on the home page, "/#org" and "https://example.com/#org" are one node
// once the page's own address is known. `local` is true when the @id points into this site or
// is a blank node, so a node for it ought to be on the page: an @id elsewhere, such as an entry
// in a public knowledge base, names something that needs no definition here. `fragment` is
// true for blank nodes and @ids with a fragment: one without, like a page's own address, names
// that page, which exists whether or not a node describes it.
export function idKey(raw, page, site) {
  const id = raw.trim();
  if (id.startsWith("_:")) return { key: `${page.file} ${id}`, local: true, fragment: true };
  const resolved = resolveReference(id, page.baseUrl, site);
  if (resolved.kind === "fragment") return { key: `${page.file}#${resolved.fragment}`, local: true, fragment: resolved.fragment !== "" };
  if (resolved.kind === "internal") {
    const target = site.lookup(resolved.path);
    return { key: `${target?.file ?? resolved.path}#${resolved.fragment}`, local: true, fragment: resolved.fragment !== "" };
  }
  try {
    return { key: new URL(id).href, local: false, fragment: false };
  } catch {
    return { key: id, local: false, fragment: false };
  }
}

function idOf(node) {
  const id = node.object["@id"];
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

// Result: { definitions: Map(key -> [node]), references: [{ node, id, key, local, fragment }] }. A node
// defines its @id when it says anything more than the @id. A reference is a nested object that
// holds only an @id; a top-level one refers to nothing in particular.
export function indexIds(page, site) {
  const definitions = new Map();
  const references = [];
  for (const node of page.jsonLdNodes) {
    const id = idOf(node);
    if (id === null) continue;
    const { key, local, fragment } = idKey(id, page, site);
    if (isReferenceOnly(node.object)) {
      if (node.parent !== null) references.push({ node, id, key, local, fragment });
      continue;
    }
    if (!definitions.has(key)) definitions.set(key, []);
    definitions.get(key).push(node);
  }
  return { definitions, references };
}

// Several rules ask for the index of the same page, so it is worked out once per page.
export function idIndex(page, site) {
  return page.once("jsonLdIds", () => indexIds(page, site));
}
