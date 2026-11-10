// A small, strict XML reader for feeds. Feed readers reject a document that is not well formed,
// so unlike the HTML tokenizer this stops at the first error and says where it is. It keeps
// elements, attributes, direct text and namespaces, which is all the feed rules ask about.

import { decodeEntities } from "../html/entities.js";

const PREDEFINED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const NAME = /[A-Za-z_:\u00c0-\uffff][\w.:\u00b7\u00c0-\uffff-]*/y;
const REFERENCE = /&(?:#(\d{1,7})|#x([0-9a-fA-F]{1,6})|([A-Za-z_:][\w.:-]*));/y;
const WHITESPACE = /[ \t\r\n]*/y;

class XmlError extends Error {
  constructor(message, offset) {
    super(message);
    this.offset = offset;
  }
}

function isXmlChar(code) {
  return code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

// What the five XML entities and character references stand for. Other named entities are an
// error unless the document declares a DTD that could define them, which is then trusted.
function decodeReferences(raw, offset, allowCustom) {
  if (!raw.includes("&")) return raw;
  let result = "";
  let at = 0;
  for (let amp = raw.indexOf("&"); amp !== -1; amp = raw.indexOf("&", at)) {
    result += raw.slice(at, amp);
    REFERENCE.lastIndex = amp;
    const match = REFERENCE.exec(raw);
    if (!match) throw new XmlError("has a bare & that does not start a reference: write &amp; instead", offset + amp);
    if (match[3] !== undefined) {
      if (match[3] in PREDEFINED) result += PREDEFINED[match[3]];
      else if (allowCustom) result += match[0];
      else {
        const known = decodeEntities(match[0]);
        const hint = known !== match[0] ? `, write &#${known.codePointAt(0)}; instead` : "";
        throw new XmlError(`uses ${match[0]}, which XML does not define${hint}`, offset + amp);
      }
    } else {
      const code = match[1] !== undefined ? Number.parseInt(match[1], 10) : Number.parseInt(match[2], 16);
      if (!isXmlChar(code)) throw new XmlError(`has ${match[0]}, which is not a character XML allows`, offset + amp);
      result += String.fromCodePoint(code);
    }
    at = REFERENCE.lastIndex;
  }
  return result + raw.slice(at);
}

class Reader {
  constructor(text) {
    this.text = text;
    this.at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.start = this.at;
    this.stack = [];
    this.root = null;
    this.customEntities = false;
  }

  name() {
    NAME.lastIndex = this.at;
    const match = NAME.exec(this.text);
    if (!match) return null;
    this.at = NAME.lastIndex;
    return match[0];
  }

  skipSpace() {
    WHITESPACE.lastIndex = this.at;
    WHITESPACE.exec(this.text);
    const moved = WHITESPACE.lastIndex !== this.at;
    this.at = WHITESPACE.lastIndex;
    return moved;
  }

  expectEnd(marker, what, from) {
    const end = this.text.indexOf(marker, this.at);
    if (end === -1) throw new XmlError(`has ${what} that is never closed`, from);
    this.at = end + marker.length;
    return end;
  }

  get top() {
    return this.stack[this.stack.length - 1] ?? null;
  }

  run() {
    const { text } = this;
    while (this.at < text.length) {
      const open = text.indexOf("<", this.at);
      const textEnd = open === -1 ? text.length : open;
      if (textEnd > this.at) this.characters(this.at, textEnd);
      if (open === -1) break;
      this.at = open;
      this.markup(open);
    }
    if (this.top) throw new XmlError(`never closes <${this.top.name}>`, this.top.start);
    if (!this.root) throw new XmlError("has no root element", 0);
    return this.root;
  }

  characters(from, to) {
    const raw = this.text.slice(from, to);
    if (!this.top) {
      if (raw.trim() !== "") throw new XmlError("has text outside the root element", from + raw.search(/\S/));
      this.at = to;
      return;
    }
    this.top.text += decodeReferences(raw, from, this.customEntities);
    this.at = to;
  }

  markup(open) {
    const { text } = this;
    if (text.startsWith("<?", open)) {
      this.at = open + 2;
      const target = this.name();
      if (target?.toLowerCase() === "xml" && open !== this.start) throw new XmlError("has an XML declaration that is not at the very start", open);
      this.expectEnd("?>", "a processing instruction", open);
    } else if (text.startsWith("<!--", open)) {
      this.at = open + 4;
      this.expectEnd("-->", "a comment", open);
    } else if (text.startsWith("<![CDATA[", open)) {
      if (!this.top) throw new XmlError("has a CDATA section outside the root element", open);
      this.at = open + 9;
      const end = this.expectEnd("]]>", "a CDATA section", open);
      this.top.text += text.slice(open + 9, end);
    } else if (text.startsWith("<!DOCTYPE", open)) {
      if (this.root) throw new XmlError("has a DOCTYPE after the root element", open);
      this.doctype(open);
    } else if (text.startsWith("</", open)) {
      this.endTag(open);
    } else {
      this.startTag(open);
    }
  }

  // Skips a DOCTYPE, internal subset and all. Entities declared there may then appear anywhere.
  doctype(open) {
    const { text } = this;
    let i = open + 9;
    let quote = null;
    let depth = 0;
    for (; i < text.length; i += 1) {
      const ch = text[i];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === "[") {
        depth += 1;
        this.customEntities = true;
      } else if (ch === "]") depth -= 1;
      else if (ch === ">" && depth <= 0) break;
    }
    if (i >= text.length) throw new XmlError("has a DOCTYPE that is never closed", open);
    this.at = i + 1;
  }

  endTag(open) {
    this.at = open + 2;
    const name = this.name();
    this.skipSpace();
    if (name === null || this.text[this.at] !== ">") throw new XmlError("has a malformed closing tag", open);
    this.at += 1;
    const { top } = this;
    if (!top) throw new XmlError(`closes </${name}>, which was never opened`, open);
    if (top.name !== name) throw new XmlError(`closes </${name}> where <${top.name}> is still open`, open);
    top.end = this.at;
    this.stack.pop();
  }

  startTag(open) {
    const { text } = this;
    this.at = open + 1;
    const name = this.name();
    if (name === null) throw new XmlError("has a < that does not start a tag: write &lt; instead", open);
    if (!this.top && this.root) throw new XmlError(`has a second root element <${name}>`, open);
    const attrs = new Map();
    for (;;) {
      const spaced = this.skipSpace();
      if (text.startsWith("/>", this.at) || text[this.at] === ">") break;
      if (this.at >= text.length) throw new XmlError(`has a <${name}> tag that is never closed`, open);
      const attrStart = this.at;
      const attr = spaced ? this.name() : null;
      if (attr === null) throw new XmlError(`has a malformed attribute in <${name}>`, attrStart);
      this.skipSpace();
      if (text[this.at] !== "=") throw new XmlError(`has an attribute ${attr} with no value in <${name}>`, attrStart);
      this.at += 1;
      this.skipSpace();
      const quote = text[this.at];
      if (quote !== '"' && quote !== "'") throw new XmlError(`has an unquoted value for ${attr} in <${name}>`, attrStart);
      const close = text.indexOf(quote, this.at + 1);
      if (close === -1) throw new XmlError(`has a value for ${attr} that is never closed`, attrStart);
      const raw = text.slice(this.at + 1, close);
      if (raw.includes("<")) throw new XmlError(`has a < inside the value of ${attr}`, attrStart);
      if (attrs.has(attr)) throw new XmlError(`repeats the attribute ${attr} in <${name}>`, attrStart);
      attrs.set(attr, decodeReferences(raw, this.at + 1, this.customEntities));
      this.at = close + 1;
    }
    const selfClosing = text[this.at] === "/";
    this.at += selfClosing ? 2 : 1;
    const parent = this.top;
    const element = { name, attrs, children: [], text: "", start: open, end: this.at, parent, namespaces: namespacesFor(attrs, parent) };
    const colon = name.indexOf(":");
    element.local = colon === -1 ? name : name.slice(colon + 1);
    element.ns = element.namespaces.get(colon === -1 ? "" : name.slice(0, colon)) ?? null;
    if (parent) parent.children.push(element);
    else this.root = element;
    if (!selfClosing) this.stack.push(element);
  }
}

const NO_NAMESPACES = new Map();

// The prefix to namespace map in scope, shared with the parent unless this element declares one.
function namespacesFor(attrs, parent) {
  const inherited = parent ? parent.namespaces : NO_NAMESPACES;
  let own = null;
  for (const [name, value] of attrs) {
    if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
    if (own === null) own = new Map(inherited);
    own.set(name === "xmlns" ? "" : name.slice(6), value);
  }
  return own ?? inherited;
}

// Returns { root, error }. The error, if any, is { message, offset } where the message reads
// after the document's name: "feed.xml has text outside the root element".
export function parseXml(text) {
  try {
    return { root: new Reader(text).run(), error: null };
  } catch (error) {
    if (!(error instanceof XmlError)) throw error;
    return { root: null, error: { message: error.message, offset: error.offset } };
  }
}

// Where the root element starts: past a byte order mark, declarations, comments, a doctype and
// space. A scan rather than one regular expression, which could backtrack for ever on a hostile
// run of declarations.
export function prologEnd(text) {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at])) at += 1;
    const close = text.startsWith("<?", at) ? "?>" : text.startsWith("<!--", at) ? "-->" : text.startsWith("<!DOCTYPE", at) ? ">" : null;
    if (close === null) return at;
    const end = text.indexOf(close, at + 2);
    if (end === -1) return text.length;
    at = end + close.length;
  }
}

// Child elements by local name, and namespace when given. `ns: null` means no namespace.
export function childElements(element, local, ns) {
  return element.children.filter((child) => child.local === local && (ns === undefined || child.ns === ns));
}

export function firstChild(element, local, ns) {
  return element.children.find((child) => child.local === local && (ns === undefined || child.ns === ns)) ?? null;
}

// The URL relative references in an element resolve against: the document's own address, then
// each xml:base on the way down.
export function xmlBase(element, documentUrl) {
  const bases = [];
  for (let node = element; node; node = node.parent) {
    const base = node.attrs.get("xml:base");
    if (base !== undefined) bases.push(base);
  }
  let url = documentUrl;
  for (let i = bases.length - 1; i >= 0; i -= 1) {
    try {
      url = new URL(bases[i], url).href;
    } catch {
      return url;
    }
  }
  return url;
}
