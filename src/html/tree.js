// Builds a light element tree from tokens, applying the implied end tags that matter:
// "<li>" closes an open "<li>", a block element closes an open "<p>", and so on. It does
// not attempt the full HTML tree construction algorithm, only enough for ancestors,
// siblings and text content to come out right on real pages and on broken ones.

import { tokenize } from "./tokenizer.js";

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr", "keygen", "frame",
]);

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

const CLOSES_PARAGRAPH = new Set([
  "address", "article", "aside", "blockquote", "center", "details", "dialog", "dir", "div",
  "dl", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5",
  "h6", "header", "hgroup", "hr", "main", "menu", "nav", "ol", "p", "pre", "section",
  "summary", "table", "ul",
]);

const PARAGRAPH_SCOPE = new Set(["button", "td", "th", "table", "caption", "object", "template", "html"]);
const BLOCK_SCOPE = new Set(["html", "body", "div", "section", "article", "main", "aside", "header", "footer", "nav", "td", "th", "template"]);

// start tag name -> [elements it implicitly closes, elements that stop the search]
const IMPLIED_CLOSE = new Map([
  ["li", [new Set(["li"]), new Set(["ul", "ol", "menu", "template"])]],
  ["dt", [new Set(["dt", "dd"]), new Set(["dl", "template"])]],
  ["dd", [new Set(["dt", "dd"]), new Set(["dl", "template"])]],
  ["tr", [new Set(["tr"]), new Set(["table", "template"])]],
  ["td", [new Set(["td", "th"]), new Set(["tr", "table", "template"])]],
  ["th", [new Set(["td", "th"]), new Set(["tr", "table", "template"])]],
  ["thead", [new Set(["thead", "tbody", "tfoot"]), new Set(["table", "template"])]],
  ["tbody", [new Set(["thead", "tbody", "tfoot"]), new Set(["table", "template"])]],
  ["tfoot", [new Set(["thead", "tbody", "tfoot"]), new Set(["table", "template"])]],
  ["option", [new Set(["option"]), new Set(["select", "datalist", "optgroup"])]],
  ["optgroup", [new Set(["optgroup"]), new Set(["select", "datalist"])]],
  ["a", [new Set(["a"]), new Set(["td", "th", "table", "button", "template", "body", "html"])]],
  ["body", [new Set(["head"]), new Set(["html"])]],
]);

function makeElement(token, parent) {
  const attrs = new Map();
  for (const attr of token.attrs) {
    // The first occurrence of a repeated attribute wins, as in a browser.
    if (!attrs.has(attr.name)) attrs.set(attr.name, attr);
  }
  return {
    type: "element",
    name: token.name,
    attrs,
    children: [],
    parent,
    start: token.start,
    tagEnd: token.end,
    end: token.end,
  };
}

export function buildTree(source) {
  const tokens = tokenize(source);
  const root = { type: "document", name: "#document", children: [], parent: null, start: 0, end: source.length };
  const stack = [root];
  const elements = [];
  const comments = [];
  let foreignDepth = 0;

  const top = () => stack[stack.length - 1];

  const popThrough = (index, endOffset) => {
    while (stack.length > index) {
      const element = stack.pop();
      element.end = endOffset;
      if (element.name === "svg" || element.name === "math") foreignDepth -= 1;
    }
  };

  const closeImplied = (targets, boundaries, offset) => {
    for (let i = stack.length - 1; i > 0; i -= 1) {
      const { name } = stack[i];
      if (targets.has(name)) {
        popThrough(i, offset);
        return;
      }
      if (boundaries.has(name)) return;
    }
  };

  for (const token of tokens) {
    if (token.type === "text") {
      top().children.push({
        type: "text",
        value: token.value,
        raw: token.raw,
        start: token.start,
        end: token.end,
        rawText: Boolean(token.rawText),
        parent: top(),
      });
    } else if (token.type === "comment") {
      const comment = { type: "comment", value: token.value, start: token.start, end: token.end, parent: top() };
      top().children.push(comment);
      comments.push(comment);
    } else if (token.type === "startTag") {
      if (foreignDepth === 0) {
        if (CLOSES_PARAGRAPH.has(token.name)) closeImplied(new Set(["p"]), PARAGRAPH_SCOPE, token.start);
        if (HEADINGS.has(token.name)) closeImplied(HEADINGS, BLOCK_SCOPE, token.start);
        const rule = IMPLIED_CLOSE.get(token.name);
        if (rule) closeImplied(rule[0], rule[1], token.start);
      }
      const element = makeElement(token, top());
      top().children.push(element);
      elements.push(element);
      const isForeignRoot = token.name === "svg" || token.name === "math";
      // "<div/>" is an open div in HTML; the slash only means something inside SVG or MathML.
      const closesItself = VOID.has(token.name) || (token.selfClosing && (foreignDepth > 0 || isForeignRoot));
      if (!closesItself) {
        stack.push(element);
        if (isForeignRoot) foreignDepth += 1;
      }
    } else if (token.type === "endTag") {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].name === token.name) {
          const closing = stack[i];
          popThrough(i, token.start);
          closing.end = token.end;
          break;
        }
      }
    }
  }
  popThrough(1, source.length);
  return { root, elements, comments };
}

// Pre-order walk with an explicit stack, so a page with thousands of unclosed tags cannot
// overflow the call stack. Returning false from the visitor skips that node's children.
export function walk(node, visit) {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (visit(current) === false) continue;
    const { children } = current;
    if (children) {
      for (let i = children.length - 1; i >= 0; i -= 1) pending.push(children[i]);
    }
  }
}

export function getAttr(element, name) {
  const attr = element.attrs.get(name);
  return attr ? attr.value : null;
}

export function hasAttr(element, name) {
  return element.attrs.has(name);
}

const NON_TEXT = new Set(["script", "style", "template", "noscript", "svg", "math"]);

export function normalizeSpace(text) {
  return text.replace(/[\s\u00a0]+/g, " ").trim();
}

// The readable text of an element, whitespace collapsed.
export function textContent(element) {
  const parts = [];
  walk(element, (node) => {
    if (node.type === "text") parts.push(node.value);
    else if (node.type === "element" && node !== element && NON_TEXT.has(node.name)) return false;
    return true;
  });
  return normalizeSpace(parts.join(""));
}

export function classList(element) {
  const value = getAttr(element, "class");
  return value ? value.split(/\s+/).filter(Boolean) : [];
}

export function ancestors(element) {
  const list = [];
  for (let node = element.parent; node && node.type === "element"; node = node.parent) list.push(node);
  return list;
}

export function isHeadingName(name) {
  return HEADINGS.has(name);
}
