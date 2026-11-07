// Reads JSON-LD (JSON for Linked Data) blocks from a page and flattens them into typed nodes.

const SCHEMA_PREFIX = /^(?:https?:\/\/(?:www\.)?schema\.org\/|schema:)/i;

// Under these keys a nested object is the page's main subject, not a passing reference,
// so it is held to the same requirements as a top-level node.
const PRIMARY_KEYS = new Set(["mainEntity"]);

// These properties have one possible type, so an object with no @type still has that type.
const IMPLIED_TYPES = new Map([["speakable", "SpeakableSpecification"], ["acceptedAnswer", "Answer"]]);

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function nodeTypes(object) {
  return asArray(object["@type"])
    .filter((type) => typeof type === "string")
    .map((type) => type.replace(SCHEMA_PREFIX, ""));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addNode(object, primary, into, impliedType) {
  const types = nodeTypes(object);
  if (types.length === 0 && impliedType) types.push(impliedType);
  into.push({ object, types, primary });
  for (const [key, value] of Object.entries(object)) {
    if (key === "@context" || key === "@type" || key === "@id") continue;
    if (key === "@graph") {
      for (const member of asArray(value)) {
        if (isObject(member)) addNode(member, true, into);
      }
      continue;
    }
    for (const child of asArray(value)) {
      if (!isObject(child)) continue;
      const isPrimaryChild = primary && PRIMARY_KEYS.has(key) && nodeTypes(child).length > 0;
      addNode(child, isPrimaryChild, into, IMPLIED_TYPES.get(key));
    }
  }
}

// Every object in a parsed block, with its types and whether it is a primary node.
export function collectNodes(data) {
  const nodes = [];
  for (const top of asArray(data)) {
    if (isObject(top)) addNode(top, true, nodes);
  }
  return nodes;
}

function errorOffset(error, textLength) {
  const match = /position (\d+)/.exec(error.message);
  return match ? Math.min(Number(match[1]), textLength) : 0;
}

export function isJsonLdScript(type) {
  return type !== null && type.split(";")[0].trim().toLowerCase() === "application/ld+json";
}

// Parses the text of one script element. `offset` is where the text starts in the page.
export function parseJsonLdText(text, offset) {
  try {
    const data = JSON.parse(text);
    return { ok: true, data, nodes: collectNodes(data) };
  } catch (error) {
    const reason = error.message.split(/ in JSON at| at position| \(line/)[0];
    return { ok: false, reason, errorOffset: offset + errorOffset(error, text.length) };
  }
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.some(hasValue);
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function lookupPath(object, path) {
  let current = [object];
  for (const key of path.split(".")) {
    const next = [];
    for (const entry of current) {
      if (isObject(entry)) next.push(...asArray(entry[key]));
    }
    current = next;
  }
  return current.some(hasValue);
}

// `spec` is a field name, a dotted path, or alternatives joined with "|".
export function hasField(object, spec) {
  return spec.split("|").some((path) => lookupPath(object, path));
}

export { asArray, isObject };
