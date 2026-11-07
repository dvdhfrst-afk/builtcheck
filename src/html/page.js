// A built HTML page, parsed once and exposed in the terms the rules think in: its visible
// text, headings, ids, structured data blocks and embedded styles.

import { Suppressions, parseDirective, parseRuleList } from "../engine/suppressions.js";
import { LineIndex } from "../site/lines.js";
import { scanCss } from "../css/scanner.js";
import { isJsonLdScript, parseJsonLdText } from "../schema/jsonld.js";
import { buildTree, classList, getAttr, hasAttr, isHeadingName, textContent, walk } from "./tree.js";

// Elements whose text is code, data or otherwise not reading copy.
const NOT_COPY = new Set([
  "script", "style", "template", "noscript", "code", "pre", "kbd", "samp", "var", "tt",
  "textarea", "svg", "math", "iframe", "noembed", "noframes", "xmp", "object",
]);

const HIDING_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$|!)/i;

function isHiddenElement(element) {
  if (hasAttr(element, "hidden")) return true;
  const style = getAttr(element, "style");
  return style !== null && HIDING_STYLE.test(style);
}

export class Page {
  constructor(file, source) {
    this.file = file;
    this.source = source;
    this.lines = new LineIndex(source);
    const { root, elements, comments } = buildTree(source);
    this.root = root;
    this.elements = elements;
    this.comments = comments;
    this.byName = new Map();
    for (const element of elements) {
      if (!this.byName.has(element.name)) this.byName.set(element.name, []);
      this.byName.get(element.name).push(element);
    }
    this.ids = this.collectIds();
    this.textRuns = this.collectVisibleText();
    this.headings = this.collectHeadings();
    this.jsonLd = this.collectJsonLd();
    this.styleSources = this.collectStyleSources();
    this.suppressions = this.collectSuppressions();
  }

  all(name) {
    return this.byName.get(name) ?? [];
  }

  first(name) {
    return this.all(name)[0] ?? null;
  }

  // The content of a meta tag, matched on either name= or property=. Case-insensitive.
  metaElements(key) {
    const wanted = key.toLowerCase();
    return this.all("meta").filter((meta) => {
      const name = getAttr(meta, "name") ?? getAttr(meta, "property");
      return name !== null && name.trim().toLowerCase() === wanted;
    });
  }

  metaContent(key) {
    const element = this.metaElements(key)[0];
    return element ? getAttr(element, "content") : null;
  }

  collectIds() {
    const ids = new Set();
    for (const element of this.elements) {
      const id = getAttr(element, "id");
      if (id) ids.add(id);
      if (element.name === "a") {
        const name = getAttr(element, "name");
        if (name) ids.add(name);
      }
    }
    return ids;
  }

  // Text a person reads: everything rendered in the body, plus the title. Each run is one
  // text node, so it maps straight back to a place in the source.
  collectVisibleText() {
    const runs = [];
    const title = this.first("title");
    if (title) {
      for (const child of title.children) {
        if (child.type === "text") runs.push(child);
      }
    }
    walk(this.root, (node) => {
      if (node.type === "text") {
        if (!node.rawText && node.parent.name !== "title" && node.parent.name !== "head") runs.push(node);
        return true;
      }
      if (node.type !== "element") return true;
      if (node.name === "head" || node.name === "title") return false;
      return !(NOT_COPY.has(node.name) || isHiddenElement(node));
    });
    return runs.filter((run) => run.value.trim() !== "");
  }

  collectHeadings() {
    const headings = [];
    for (const element of this.elements) {
      if (!isHeadingName(element.name)) continue;
      headings.push({ element, level: Number(element.name[1]), text: textContent(element) });
    }
    return headings;
  }

  collectJsonLd() {
    const blocks = [];
    for (const script of this.all("script")) {
      if (!isJsonLdScript(getAttr(script, "type"))) continue;
      const textNode = script.children.find((child) => child.type === "text");
      const text = textNode ? textNode.value : "";
      const offset = textNode ? textNode.start : script.tagEnd;
      blocks.push({ script, offset: script.start, ...parseJsonLdText(text, offset) });
    }
    return blocks;
  }

  // All parsed nodes across every block on the page.
  get jsonLdNodes() {
    return this.jsonLd.flatMap((block) => (block.ok ? block.nodes : []));
  }

  collectStyleSources() {
    const sources = [];
    for (const style of this.all("style")) {
      const type = getAttr(style, "type");
      if (type !== null && type.trim() !== "" && type.trim().toLowerCase() !== "text/css") continue;
      const textNode = style.children.find((child) => child.type === "text");
      if (!textNode) continue;
      sources.push({ file: this.file, kind: "block", baseOffset: textNode.start, ...scanCss(textNode.value) });
    }
    for (const element of this.elements) {
      const attr = element.attrs.get("style");
      if (!attr || attr.value.trim() === "") continue;
      sources.push({ file: this.file, kind: "inline", baseOffset: attr.valueStart, ...scanCss(attr.value), element });
    }
    return sources;
  }

  collectSuppressions() {
    const suppressions = new Suppressions();
    const elementAfter = (offset) => {
      let low = 0;
      let high = this.elements.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (this.elements[middle].start >= offset) high = middle;
        else low = middle + 1;
      }
      return this.elements[low] ?? null;
    };
    for (const comment of this.comments) {
      const directive = parseDirective(comment.value);
      if (!directive) continue;
      if (directive.kind === "file") {
        suppressions.addFile(directive.rules);
      } else if (directive.kind === "next-line") {
        suppressions.addLine(this.lines.locate(comment.end).line + 1, directive.rules);
      } else {
        const next = elementAfter(comment.end);
        if (next) suppressions.addRange(next.start, next.end, directive.rules);
      }
    }
    for (const source of this.styleSources) {
      if (source.kind !== "block") continue;
      for (const comment of source.comments) {
        const directive = parseDirective(comment.text);
        if (!directive) continue;
        if (directive.kind === "file") suppressions.addFile(directive.rules);
        else if (directive.kind === "next-line") {
          suppressions.addLine(this.lines.locate(source.baseOffset + comment.end).line + 1, directive.rules);
        }
      }
    }
    for (const element of this.elements) {
      const value = getAttr(element, "data-builtcheck-ignore");
      if (value !== null) suppressions.addRange(element.start, element.end, parseRuleList(value));
    }
    return suppressions;
  }
}

// True if the element sits somewhere its text is not rendered.
export function isInsideHidden(element) {
  for (let node = element; node && node.type === "element"; node = node.parent) {
    if (node !== element && NOT_COPY.has(node.name)) return true;
    if (isHiddenElement(node)) return true;
  }
  return false;
}

// True if the element or an ancestor is hidden by a utility class at some screen width,
// which usually means a second copy of the same content for another breakpoint.
export function hiddenByClass(element) {
  for (let node = element; node && node.type === "element"; node = node.parent) {
    for (const token of classList(node)) {
      if (token === "d-none" || /(^|:)hidden$/.test(token)) return true;
    }
  }
  return false;
}
