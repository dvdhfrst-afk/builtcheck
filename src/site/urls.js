// Resolves a reference found in a page or stylesheet against the built site.

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const FAKE_ORIGIN = "http://builtcheck.invalid";

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// Returns one of:
//   { kind: "empty" }              nothing to resolve
//   { kind: "fragment", fragment } in-page reference
//   { kind: "scheme", scheme }     mailto:, tel:, data:, javascript: and the like
//   { kind: "external" }           another host
//   { kind: "outside" }            same host, outside the base path of this build
//   { kind: "invalid" }            not parseable as a URL
//   { kind: "internal", path, fragment } path from the build root, with its leading slash
export function resolveReference(raw, baseUrl, site) {
  const reference = raw.trim();
  if (reference === "") return { kind: "empty" };
  if (reference.startsWith("#")) return { kind: "fragment", fragment: safeDecode(reference.slice(1)) };
  const scheme = SCHEME.exec(reference);
  if (scheme && !/^https?$/i.test(scheme[1])) return { kind: "scheme", scheme: scheme[1].toLowerCase() };
  let url;
  try {
    url = new URL(reference, baseUrl);
  } catch {
    return { kind: "invalid" };
  }
  if (url.origin !== FAKE_ORIGIN && !site.isOwnHost(url.hostname)) return { kind: "external" };
  const pathname = site.stripBasePath(safeDecode(url.pathname));
  if (pathname === null) return { kind: "outside" };
  return { kind: "internal", path: pathname, fragment: safeDecode(url.hash.slice(1)) };
}

// The URL relative references in a file resolve against: its <base href> if it has one,
// otherwise the path it is served from.
export function baseUrlForFile(file, site, baseHref = null) {
  const encoded = file.split("/").map(encodeURIComponent).join("/");
  const own = `${FAKE_ORIGIN}${site.basePath}/${encoded}`;
  if (baseHref === null) return own;
  try {
    return new URL(baseHref, own).href;
  } catch {
    return own;
  }
}

// The target of a fragment, without any text directive. Returns null for "#", "#top" and an
// empty target, which browsers always honor.
export function meaningfulFragment(fragment) {
  const target = fragment.split(":~:")[0];
  if (target === "" || target.toLowerCase() === "top") return null;
  return target;
}
