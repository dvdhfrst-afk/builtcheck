// Parses CSS selectors and matches them against the element tree.
//
// A static file cannot say whether an element is hovered, or which classes a script will add,
// so matching answers "could this selector apply to this element?". A selector whose answer
// depends on something the file does not show is marked `conditional`, which lets callers
// separate what always applies from what only might.
//
// parseSelectorList(text) returns one entry per comma-separated selector:
//   { text, parts, specificity: [ids, classes, types], conditional, pseudoElement, unparsed }
// A selector the parser cannot read has `unparsed: true` and could match anything. Selectors
// never throw, however broken.

import { getAttr, hasAttr } from "../html/tree.js";

// Pseudo-classes that depend on interaction, form state, the URL or the browser.
const STATE_PSEUDO_CLASSES = new Set([
  "active", "any-link-visited", "autofill", "blank", "buffering", "checked", "closed", "current", "default", "defined",
  "dir", "disabled", "enabled", "focus", "focus-visible", "focus-within", "fullscreen", "future", "has", "host",
  "host-context", "hover", "in-range", "indeterminate", "invalid", "lang", "local-link", "modal", "muted", "open",
  "optional", "out-of-range", "past", "paused", "picture-in-picture", "placeholder-shown", "playing", "popover-open",
  "read-only", "read-write", "required", "scope", "seeking", "stalled", "state", "target", "target-within",
  "user-invalid", "user-valid", "valid", "visited", "volume-locked",
]);

// Written with one colon for historical reasons, but they are pseudo-elements.
const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);

const NESTED_LIST = new Set(["not", "is", "where", "matches", "any", "-webkit-any", "-moz-any"]);
const NTH = new Set(["nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type"]);
const STRUCTURAL = new Set([
  "root", "empty", "first-child", "last-child", "only-child", "first-of-type", "last-of-type", "only-of-type", "link", "any-link",
]);

const NOT_NAME = /[\s>+~,.#:[\]()*|=^$"'&{}/]/;

class Reader {
  constructor(text) {
    this.text = text;
    this.pos = 0;
  }

  get done() {
    return this.pos >= this.text.length;
  }

  peek(offset = 0) {
    return this.text[this.pos + offset];
  }

  skipSpace() {
    const start = this.pos;
    while (!this.done && /\s/.test(this.peek())) this.pos += 1;
    return this.pos > start;
  }

  // Reads an identifier, undoing CSS escapes such as "md\:gap-4" and "\31 2".
  readName() {
    let name = "";
    while (!this.done) {
      const ch = this.peek();
      if (ch === "\\") {
        const hex = /^[0-9a-fA-F]{1,6}\s?/.exec(this.text.slice(this.pos + 1, this.pos + 8));
        if (hex) {
          const code = parseInt(hex[0], 16);
          name += code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
          this.pos += 1 + hex[0].length;
        } else {
          name += this.peek(1) ?? "";
          this.pos += 2;
        }
      } else if (NOT_NAME.test(ch)) {
        break;
      } else {
        name += ch;
        this.pos += 1;
      }
    }
    return name;
  }

  readBalanced() {
    let depth = 1;
    const start = this.pos;
    while (!this.done) {
      const ch = this.peek();
      if (ch === "\\") {
        this.pos += 2;
        continue;
      }
      if (ch === '"' || ch === "'") {
        const close = this.text.indexOf(ch, this.pos + 1);
        this.pos = close === -1 ? this.text.length : close + 1;
        continue;
      }
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          const inner = this.text.slice(start, this.pos);
          this.pos += 1;
          return inner;
        }
      }
      this.pos += 1;
    }
    return null;
  }
}

class Unreadable extends Error {}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "\\") i += 1;
    else if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// "2n+1", "odd", "even", "-n + 3" or "5". Returns [a, b], or null for anything else.
function parseNth(text) {
  const value = text.trim().toLowerCase();
  if (value === "odd") return [2, 1];
  if (value === "even") return [2, 0];
  const match = /^([+-]?\d*)n\s*(?:([+-])\s*(\d+))?$/.exec(value);
  if (match) {
    const lead = match[1];
    const a = lead === "" || lead === "+" ? 1 : lead === "-" ? -1 : Number(lead);
    return [a, match[3] ? Number(`${match[2]}${match[3]}`) : 0];
  }
  return /^[+-]?\d+$/.test(value) ? [0, Number(value)] : null;
}

function readAttribute(reader) {
  reader.pos += 1;
  reader.skipSpace();
  const name = reader.readName().toLowerCase();
  if (name === "") throw new Unreadable();
  reader.skipSpace();
  if (reader.peek() === "]") {
    reader.pos += 1;
    return { name, op: null, value: null, insensitive: false };
  }
  let op = "=";
  if (reader.peek() !== "=") {
    op = reader.peek();
    if (!"~|^$*".includes(op ?? "?") || reader.peek(1) !== "=") throw new Unreadable();
    reader.pos += 1;
  }
  reader.pos += 1;
  reader.skipSpace();
  let value;
  const quote = reader.peek();
  if (quote === '"' || quote === "'") {
    value = "";
    reader.pos += 1;
    while (!reader.done && reader.peek() !== quote) {
      if (reader.peek() === "\\") reader.pos += 1;
      value += reader.peek() ?? "";
      reader.pos += 1;
    }
    reader.pos += 1;
  } else {
    value = reader.readName();
  }
  reader.skipSpace();
  let insensitive = false;
  if (/^[iIsS]$/.test(reader.peek() ?? "")) {
    insensitive = /[iI]/.test(reader.peek());
    reader.pos += 1;
    reader.skipSpace();
  }
  if (reader.peek() !== "]") throw new Unreadable();
  reader.pos += 1;
  return { name, op, value, insensitive };
}

function emptyCompound() {
  return { tag: null, ids: [], classes: [], attributes: [], pseudos: [] };
}

function readPseudo(reader, compound, result) {
  reader.pos += 1;
  let isElement = false;
  if (reader.peek() === ":") {
    isElement = true;
    reader.pos += 1;
  }
  const name = reader.readName().toLowerCase();
  if (name === "") throw new Unreadable();
  let argument = null;
  if (reader.peek() === "(") {
    reader.pos += 1;
    argument = reader.readBalanced();
    if (argument === null) throw new Unreadable();
  }
  if (isElement || LEGACY_PSEUDO_ELEMENTS.has(name) || name.startsWith("-webkit-") || name.startsWith("-moz-") || name.startsWith("-ms-")) {
    if (!NESTED_LIST.has(name)) {
      result.pseudoElement = name;
      result.specificity[2] += 1;
      return;
    }
  }
  if (NESTED_LIST.has(name)) {
    const list = parseSelectorList(argument ?? "");
    const widest = list.reduce((best, entry) => (compareSpecificity(entry.specificity, best) > 0 ? entry.specificity : best), [0, 0, 0]);
    if (name !== "where") widest.forEach((value, index) => { result.specificity[index] += value; });
    if (list.some((entry) => entry.conditional || entry.unparsed)) result.conditional = true;
    compound.pseudos.push({ kind: name === "not" ? "not" : "is", list });
    return;
  }
  if (NTH.has(name)) {
    const nth = parseNth(argument ?? "");
    result.specificity[1] += 1;
    if (nth) {
      compound.pseudos.push({ kind: name, nth });
    } else {
      // "2n of .a" and the like: could match, on this reading.
      result.conditional = true;
    }
    return;
  }
  result.specificity[1] += 1;
  if (STRUCTURAL.has(name)) {
    compound.pseudos.push({ kind: name });
    return;
  }
  // State pseudo-classes, and any this parser does not know: could match.
  if (!STATE_PSEUDO_CLASSES.has(name)) result.unknownPseudo = true;
  result.conditional = true;
}

function parseComplex(text) {
  const result = {
    text,
    parts: [],
    specificity: [0, 0, 0],
    conditional: false,
    pseudoElement: null,
    unparsed: false,
    unknownPseudo: false,
  };
  const reader = new Reader(text);
  reader.skipSpace();
  let combinator = null;
  while (!reader.done) {
    const compound = emptyCompound();
    let sawAny = false;
    while (!reader.done) {
      const ch = reader.peek();
      if (ch === "*") {
        reader.pos += 1;
        sawAny = true;
      } else if (ch === "#") {
        reader.pos += 1;
        const id = reader.readName();
        if (id === "") throw new Unreadable();
        compound.ids.push(id);
        result.specificity[0] += 1;
        sawAny = true;
      } else if (ch === ".") {
        reader.pos += 1;
        const name = reader.readName();
        if (name === "") throw new Unreadable();
        compound.classes.push(name);
        result.specificity[1] += 1;
        sawAny = true;
      } else if (ch === "[") {
        compound.attributes.push(readAttribute(reader));
        result.specificity[1] += 1;
        sawAny = true;
      } else if (ch === ":") {
        readPseudo(reader, compound, result);
        sawAny = true;
      } else if (ch === "|") {
        // A namespace prefix: the name after it is what counts in an HTML document.
        reader.pos += 1;
        compound.tag = null;
      } else if (/[\s>+~]/.test(ch)) {
        break;
      } else {
        const name = reader.readName();
        if (name === "") throw new Unreadable();
        compound.tag = name.toLowerCase();
        result.specificity[2] += 1;
        sawAny = true;
      }
    }
    if (!sawAny) throw new Unreadable();
    result.parts.push({ combinator, compound });
    const sawSpace = reader.skipSpace();
    if (reader.done) break;
    const next = reader.peek();
    if (next === ">" || next === "+" || next === "~") {
      combinator = next;
      reader.pos += 1;
      reader.skipSpace();
      if (reader.done) throw new Unreadable();
    } else if (sawSpace) {
      combinator = " ";
    } else {
      throw new Unreadable();
    }
  }
  if (result.parts.length === 0) throw new Unreadable();
  return result;
}

const parsedLists = new Map();

export function parseSelectorList(text) {
  const known = parsedLists.get(text);
  if (known) return known;
  const list = splitTopLevel(text).map((piece) => {
    try {
      return parseComplex(piece);
    } catch (error) {
      if (!(error instanceof Unreadable)) throw error;
      return { text: piece, parts: [], specificity: [0, 0, 0], conditional: true, pseudoElement: null, unparsed: true, unknownPseudo: false };
    }
  });
  parsedLists.set(text, list);
  return list;
}

export function compareSpecificity(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// Combines a nested rule with the selector it sits in, as CSS nesting does. Each level is a
// selector list as written in the source.
export function resolveNesting(path) {
  let resolved = "";
  for (const level of path) {
    if (resolved === "") {
      resolved = level;
    } else {
      const parent = `:is(${resolved})`;
      resolved = splitTopLevel(level)
        .map((piece) => (piece.includes("&") ? piece.replace(/&/g, parent) : `${parent} ${piece}`))
        .join(", ");
    }
  }
  return resolved;
}

// The most selective thing an element must have to match, for indexing: "#id", ".class" or a
// tag name, taken from the rightmost compound. Null when it has none, as with "*" or ":is(a)".
export function selectorKey(complex) {
  if (complex.parts.length === 0) return null;
  const { compound } = complex.parts[complex.parts.length - 1];
  if (compound.ids.length > 0) return `#${compound.ids[0]}`;
  if (compound.classes.length > 0) return `.${compound.classes[0]}`;
  return compound.tag;
}

// Every name the rightmost compound mentions. Used to spot a rule aimed at an element whose
// other conditions (a class a script adds, say) the static file does not meet.
export function subjectNames(complex) {
  if (complex.parts.length === 0) return [];
  const { compound } = complex.parts[complex.parts.length - 1];
  return [...compound.ids.map((id) => `#${id}`), ...compound.classes.map((name) => `.${name}`)];
}

// Every class and id the selector needs, in any of its parts.
export function requiredNames(complex) {
  return complex.parts.flatMap(({ compound }) => [...compound.ids.map((id) => `#${id}`), ...compound.classes.map((name) => `.${name}`)]);
}

function elementSiblings(element) {
  const parent = element.parent;
  return parent ? parent.children.filter((child) => child.type === "element") : [element];
}

const siblingPositions = new WeakMap();
const siblingLists = new WeakMap();

function positionOf(element) {
  const parent = element.parent;
  if (!parent) return { index: 1, total: 1, typeIndex: 1, typeTotal: 1 };
  let positions = siblingPositions.get(parent);
  if (!positions) {
    positions = new Map();
    const siblings = elementSiblings(element);
    siblingLists.set(parent, siblings);
    const typeCounts = new Map();
    for (const sibling of siblings) typeCounts.set(sibling.name, (typeCounts.get(sibling.name) ?? 0) + 1);
    const seen = new Map();
    siblings.forEach((sibling, index) => {
      const typeIndex = (seen.get(sibling.name) ?? 0) + 1;
      seen.set(sibling.name, typeIndex);
      positions.set(sibling, { index: index + 1, total: siblings.length, typeIndex, typeTotal: typeCounts.get(sibling.name) });
    });
    siblingPositions.set(parent, positions);
  }
  return positions.get(element);
}

function nthMatches([a, b], position) {
  if (a === 0) return position === b;
  const steps = (position - b) / a;
  return steps >= 0 && Number.isInteger(steps);
}

function isElementEmpty(element) {
  return element.children.every((child) => child.type === "comment");
}

function pseudoMatches(pseudo, element) {
  const position = () => positionOf(element);
  switch (pseudo.kind) {
    case "is":
      return pseudo.list.some((entry) => matchesSelector(element, entry));
    case "not":
      // An inner selector that only might apply can also not apply, so :not() could hold.
      return pseudo.list.every((entry) => entry.conditional || entry.unparsed || !matchesSelector(element, entry));
    case "root":
      return element.name === "html" || element.parent?.type === "document";
    case "empty":
      return isElementEmpty(element);
    case "link":
    case "any-link":
      return (element.name === "a" || element.name === "area") && hasAttr(element, "href");
    case "first-child":
      return position().index === 1;
    case "last-child":
      return position().index === position().total;
    case "only-child":
      return position().total === 1;
    case "first-of-type":
      return position().typeIndex === 1;
    case "last-of-type":
      return position().typeIndex === position().typeTotal;
    case "only-of-type":
      return position().typeTotal === 1;
    case "nth-child":
      return nthMatches(pseudo.nth, position().index);
    case "nth-last-child":
      return nthMatches(pseudo.nth, position().total - position().index + 1);
    case "nth-of-type":
      return nthMatches(pseudo.nth, position().typeIndex);
    case "nth-last-of-type":
      return nthMatches(pseudo.nth, position().typeTotal - position().typeIndex + 1);
    default:
      return true;
  }
}

function attributeMatches({ name, op, value, insensitive }, element) {
  const raw = getAttr(element, name);
  if (raw === null) return false;
  if (op === null) return true;
  const actual = insensitive ? raw.toLowerCase() : raw;
  const wanted = insensitive ? value.toLowerCase() : value;
  switch (op) {
    case "=":
      return actual === wanted;
    case "~":
      return wanted !== "" && actual.split(/\s+/).includes(wanted);
    case "|":
      return actual === wanted || actual.startsWith(`${wanted}-`);
    case "^":
      return wanted !== "" && actual.startsWith(wanted);
    case "$":
      return wanted !== "" && actual.endsWith(wanted);
    case "*":
      return wanted !== "" && actual.includes(wanted);
    default:
      return false;
  }
}

function compoundMatches(compound, element) {
  if (compound.tag !== null && compound.tag !== element.name) return false;
  if (compound.ids.length > 0) {
    const id = getAttr(element, "id");
    if (!compound.ids.every((wanted) => wanted === id)) return false;
  }
  if (compound.classes.length > 0) {
    const classes = (getAttr(element, "class") ?? "").split(/\s+/);
    if (!compound.classes.every((wanted) => classes.includes(wanted))) return false;
  }
  return (
    compound.attributes.every((attribute) => attributeMatches(attribute, element)) &&
    compound.pseudos.every((pseudo) => pseudoMatches(pseudo, element))
  );
}

function previousElement(element) {
  const parent = element.parent;
  if (!parent) return null;
  positionOf(element);
  return siblingLists.get(parent)[positionOf(element).index - 2] ?? null;
}

function matchFrom(parts, index, element) {
  if (!compoundMatches(parts[index].compound, element)) return false;
  if (index === 0) return true;
  const { combinator } = parts[index];
  if (combinator === ">") {
    const parent = element.parent;
    return Boolean(parent && parent.type === "element" && matchFrom(parts, index - 1, parent));
  }
  if (combinator === "+") {
    const previous = previousElement(element);
    return Boolean(previous && matchFrom(parts, index - 1, previous));
  }
  if (combinator === "~") {
    for (let sibling = previousElement(element); sibling; sibling = previousElement(sibling)) {
      if (matchFrom(parts, index - 1, sibling)) return true;
    }
    return false;
  }
  for (let parent = element.parent; parent && parent.type === "element"; parent = parent.parent) {
    if (matchFrom(parts, index - 1, parent)) return true;
  }
  return false;
}

// Could this parsed selector apply to this element?
export function matchesSelector(element, complex) {
  if (complex.unparsed) return true;
  return matchFrom(complex.parts, complex.parts.length - 1, element);
}

// The same question for a selector list in text form, for callers with one selector to test.
export function elementMatches(element, text) {
  return parseSelectorList(text).some((complex) => matchesSelector(element, complex));
}
