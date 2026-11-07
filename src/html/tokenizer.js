// A tolerant, hand-written HTML tokenizer.
//
// It never throws and always makes progress. Broken input degrades into text or a
// best-effort tag, the same way a browser keeps going. Every token records source
// offsets so findings can point at a line and column.

import { decodeEntities } from "./entities.js";

// Content of these elements is not markup, so the tokenizer looks only for the end tag.
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes"]);
// Same, except character references inside still decode.
const ESCAPABLE_RAW_TEXT = new Set(["textarea", "title"]);

function isWhitespace(code) {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d;
}

function isAsciiLetter(code) {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

class Tokenizer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.tokens = [];
    this.textStart = -1;
  }

  run() {
    const { src } = this;
    const length = src.length;
    while (this.pos < length) {
      const open = src.indexOf("<", this.pos);
      if (open === -1) {
        this.markText(this.pos);
        this.pos = length;
        break;
      }
      if (open > this.pos) this.markText(this.pos);
      this.pos = open;
      if (!this.readMarkup()) {
        // A "<" that opens nothing is ordinary text, as in "1 < 2".
        this.markText(open);
        this.pos = open + 1;
      }
    }
    this.flushText(length);
    return this.tokens;
  }

  markText(start) {
    if (this.textStart === -1) this.textStart = start;
  }

  flushText(end) {
    if (this.textStart === -1 || end <= this.textStart) {
      this.textStart = -1;
      return;
    }
    const raw = this.src.slice(this.textStart, end);
    this.tokens.push({ type: "text", raw, value: decodeEntities(raw), start: this.textStart, end });
    this.textStart = -1;
  }

  // Tries to read a tag, comment or declaration at this.pos. Returns false if the "<"
  // does not begin any of them.
  readMarkup() {
    const { src, pos } = this;
    const next = src.charCodeAt(pos + 1);
    if (next === 0x21 /* ! */) {
      this.flushText(pos);
      if (src.startsWith("<!--", pos)) this.readComment();
      else this.readDeclaration();
      return true;
    }
    if (next === 0x3f /* ? */) {
      this.flushText(pos);
      this.readDeclaration();
      return true;
    }
    if (next === 0x2f /* / */) {
      if (!isAsciiLetter(src.charCodeAt(pos + 2))) {
        if (pos + 2 >= src.length) return false;
        this.flushText(pos);
        this.readDeclaration();
        return true;
      }
      this.flushText(pos);
      this.readEndTag();
      return true;
    }
    if (isAsciiLetter(next)) {
      this.flushText(pos);
      this.readStartTag();
      return true;
    }
    return false;
  }

  readComment() {
    const { src, pos } = this;
    const bodyStart = pos + 4;
    // "<!-->" and "<!--->" are complete, empty comments.
    if (src.startsWith(">", bodyStart) || src.startsWith("->", bodyStart)) {
      const end = src.indexOf(">", bodyStart) + 1;
      this.tokens.push({ type: "comment", value: "", start: pos, end });
      this.pos = end;
      return;
    }
    let close = src.indexOf("-->", bodyStart);
    let closeLength = 3;
    const altClose = src.indexOf("--!>", bodyStart);
    if (altClose !== -1 && (close === -1 || altClose < close)) {
      close = altClose;
      closeLength = 4;
    }
    const end = close === -1 ? src.length : close + closeLength;
    const value = src.slice(bodyStart, close === -1 ? src.length : close);
    this.tokens.push({ type: "comment", value, start: pos, end });
    this.pos = end;
  }

  // Doctypes, processing instructions and other "<!x>" forms. Nothing here carries content.
  readDeclaration() {
    const { src, pos } = this;
    if (src.startsWith("<![CDATA[", pos)) {
      const close = src.indexOf("]]>", pos);
      const end = close === -1 ? src.length : close + 3;
      this.tokens.push({ type: "declaration", value: src.slice(pos, end), start: pos, end });
      this.pos = end;
      return;
    }
    const close = src.indexOf(">", pos);
    const end = close === -1 ? src.length : close + 1;
    this.tokens.push({ type: "declaration", value: src.slice(pos, end), start: pos, end });
    this.pos = end;
  }

  readTagName(from) {
    const { src } = this;
    let i = from;
    while (i < src.length) {
      const code = src.charCodeAt(i);
      if (isWhitespace(code) || code === 0x2f || code === 0x3e) break;
      i += 1;
    }
    return { name: src.slice(from, i).toLowerCase(), next: i };
  }

  readEndTag() {
    const { src, pos } = this;
    const { name, next } = this.readTagName(pos + 2);
    const close = src.indexOf(">", next);
    const end = close === -1 ? src.length : close + 1;
    this.tokens.push({ type: "endTag", name, start: pos, end });
    this.pos = end;
  }

  readStartTag() {
    const { src, pos } = this;
    const { name, next } = this.readTagName(pos + 1);
    const { attrs, selfClosing, end } = this.readAttributes(next);
    this.tokens.push({ type: "startTag", name, attrs, selfClosing, start: pos, end });
    this.pos = end;
    if (selfClosing) {
      // Self-closing syntax has no effect on raw text elements in HTML, except that
      // authors of SVG use "<script/>" and "<style/>", so honor it rather than swallow
      // the rest of the page.
      return;
    }
    if (RAW_TEXT.has(name)) this.readRawText(name, false);
    else if (ESCAPABLE_RAW_TEXT.has(name)) this.readRawText(name, true);
  }

  readAttributes(from) {
    const { src } = this;
    const length = src.length;
    const attrs = [];
    let i = from;
    let selfClosing = false;
    while (i < length) {
      let code = src.charCodeAt(i);
      if (isWhitespace(code)) {
        i += 1;
        continue;
      }
      if (code === 0x3e /* > */) return { attrs, selfClosing, end: i + 1 };
      if (code === 0x2f /* / */) {
        if (src.charCodeAt(i + 1) === 0x3e) return { attrs, selfClosing: true, end: i + 2 };
        i += 1;
        continue;
      }
      // A "<" here means the tag was never closed, as in "<a href=x <p>".
      if (code === 0x3c /* < */) return { attrs, selfClosing, end: i };

      const nameStart = i;
      if (code === 0x3d /* = */) i += 1;
      while (i < length) {
        code = src.charCodeAt(i);
        if (isWhitespace(code) || code === 0x2f || code === 0x3e || code === 0x3d) break;
        i += 1;
      }
      const name = src.slice(nameStart, i).toLowerCase();
      let j = i;
      while (j < length && isWhitespace(src.charCodeAt(j))) j += 1;
      if (src.charCodeAt(j) !== 0x3d) {
        attrs.push({ name, value: "", start: nameStart, valueStart: nameStart, hasValue: false });
        continue;
      }
      j += 1;
      while (j < length && isWhitespace(src.charCodeAt(j))) j += 1;
      const quote = src.charCodeAt(j);
      let raw;
      let valueStart;
      if (quote === 0x22 || quote === 0x27) {
        valueStart = j + 1;
        const close = src.indexOf(quote === 0x22 ? '"' : "'", valueStart);
        if (close === -1) {
          // An unterminated quote: stop at the end of the tag instead of losing the page.
          const tagEnd = src.indexOf(">", valueStart);
          const stop = tagEnd === -1 ? length : tagEnd;
          raw = src.slice(valueStart, stop);
          i = stop;
        } else {
          raw = src.slice(valueStart, close);
          i = close + 1;
        }
      } else {
        valueStart = j;
        i = j;
        while (i < length) {
          code = src.charCodeAt(i);
          if (isWhitespace(code) || code === 0x3e) break;
          i += 1;
        }
        raw = src.slice(valueStart, i);
      }
      attrs.push({
        name,
        value: decodeEntities(raw, { attribute: true }),
        start: nameStart,
        valueStart,
        hasValue: true,
      });
    }
    return { attrs, selfClosing, end: length };
  }

  readRawText(name, decode) {
    const { src, pos } = this;
    const pattern = new RegExp(`</${name}(?=[\\s/>]|$)`, "gi");
    pattern.lastIndex = pos;
    const match = pattern.exec(src);
    const stop = match ? match.index : src.length;
    if (stop > pos) {
      const raw = src.slice(pos, stop);
      this.tokens.push({
        type: "text",
        raw,
        value: decode ? decodeEntities(raw) : raw,
        start: pos,
        end: stop,
        rawText: !decode,
      });
    }
    this.pos = stop;
    if (match) this.readEndTag();
  }
}

export function tokenize(source) {
  return new Tokenizer(source).run();
}
