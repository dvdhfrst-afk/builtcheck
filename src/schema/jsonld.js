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

function joinPath(path, step) {
  return path === "" ? step : `${path}.${step}`;
}

// Each node records where it sits: its parent node, the key it sits under and a path such as
// "@graph[2].offers[0]", so a message can say which node it means.
function addNode(object, primary, into, impliedType, parent, key, path) {
  const types = nodeTypes(object);
  if (types.length === 0 && impliedType) types.push(impliedType);
  const node = { object, types, primary, parent, key, path };
  into.push(node);
  for (const [childKey, value] of Object.entries(object)) {
    if (childKey === "@context" || childKey === "@type" || childKey === "@id") continue;
    const many = Array.isArray(value);
    asArray(value).forEach((child, index) => {
      if (!isObject(child)) return;
      if (childKey === "@graph") {
        addNode(child, true, into, undefined, null, null, joinPath(path, `@graph[${index}]`));
        return;
      }
      const isPrimaryChild = primary && PRIMARY_KEYS.has(childKey) && nodeTypes(child).length > 0;
      const step = many ? `${childKey}[${index}]` : childKey;
      addNode(child, isPrimaryChild, into, IMPLIED_TYPES.get(childKey), node, childKey, joinPath(path, step));
    });
  }
}

// Every object in a parsed block, with its types, whether it is a primary node, and where it sits.
export function collectNodes(data) {
  const nodes = [];
  const many = Array.isArray(data);
  asArray(data).forEach((top, index) => {
    if (isObject(top)) addNode(top, true, nodes, undefined, null, null, many ? `[${index}]` : "");
  });
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

// A property of the object itself, never one inherited from Object.prototype such as "constructor".
export function ownValue(object, key) {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

// A member with only an @id is a reference to a node defined elsewhere.
export function isReferenceOnly(object) {
  return Object.keys(object).every((key) => key === "@id");
}

export { asArray, isObject };
