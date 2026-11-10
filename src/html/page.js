// A built HTML page, exposed in the terms the rules think in: its visible text, headings, ids,
// structured data blocks and embedded styles. A parsed page is many times the size of its file,
// so the site keeps only a summary of each one and parses it again when the rules run. What
// only the rules need is worked out on first use.

import { Suppressions, parseDirective, parseRuleList } from "../engine/suppressions.js";
import { LineIndex } from "../site/lines.js";
import { nextRuleEnd, scanCss } from "../css/scanner.js";
import { isJsonLdScript, parseJsonLdText } from "../schema/jsonld.js";
import { headSummary } from "../seo/head.js";
import { matchesSelector, requiredNames, selectorKey } from "../css/selectors.js";
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

// A copy of a string that does not keep alive the text it was cut from. JavaScript engines
// implement slices as views of the parent, which here would be the whole page.
export function detached(text) {
  return text === null ? null : Buffer.from(text, "utf8").toString("utf8");
}

export class Page {
  constructor(file, source) {
    this.file = file;
    this.source = source;
    this.styles = null;
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
    this.derived = new Map();
    this.ids = this.collectIds();
  }

  once(key, compute) {
    if (!this.derived.has(key)) this.derived.set(key, compute());
    return this.derived.get(key);
  }

  get textRuns() {
    return this.once("textRuns", () => {
      const runs = this.collectVisibleText();
      const { styles } = this;
      return styles ? runs.filter((run) => run.parent.name === "title" || !styles.isAlwaysHidden(run.parent)) : runs;
    });
  }

  get headings() {
    return this.once("headings", () => this.collectHeadings());
  }

  get jsonLd() {
    return this.once("jsonLd", () => this.collectJsonLd());
  }

  get styleSources() {
    return this.once("styleSources", () => this.collectStyleSources());
  }

  get suppressions() {
    return this.once("suppressions", () => this.collectSuppressions());
  }

  // Elements by "tag", "#id" and ".class", for matching selectors against this page.
  get elementIndex() {
    return this.once("elementIndex", () => {
      const index = new Map();
      const add = (key, element) => {
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(element);
      };
      for (const element of this.elements) {
        add(element.name, element);
        const id = getAttr(element, "id");
        if (id) add(`#${id}`, element);
        for (const name of classList(element)) add(`.${name}`, element);
      }
      return index;
    });
  }

  // Up to `limit` elements on this page that a parsed selector could match.
  matching(complex, limit = Infinity) {
    const index = this.elementIndex;
    if (requiredNames(complex).some((name) => !index.has(name))) return [];
    const key = selectorKey(complex);
    const candidates = key === null ? this.elements : index.get(key) ?? [];
    const found = [];
    for (const element of candidates) {
      if (found.length >= limit) break;
      if (matchesSelector(element, complex)) found.push(element);
    }
    return found;
  }

  // What the site keeps once this tree is gone: what other pages and site-wide rules ask about.
  summary() {
    const canonical = this.all("link").find((link) => (getAttr(link, "rel") ?? "").trim().toLowerCase() === "canonical");
    const socialImages = [];
    for (const key of ["og:image", "og:image:url", "og:image:secure_url"]) {
      for (const meta of this.metaElements(key)) {
        const content = getAttr(meta, "content");
        if (content !== null && content.trim() !== "") socialImages.push(content);
      }
    }
    const base = this.first("base");
    const head = headSummary(this);
    return {
      file: this.file,
      ids: new Set([...this.ids].map(detached)),
      noindex: this.noindex,
      redirect: this.redirect,
      canonicalHref: canonical ? detached(getAttr(canonical, "href")) : null,
      baseHref: base ? detached(getAttr(base, "href")) : null,
      socialImages: socialImages.map(detached),
      // Compared across pages by the meta and i18n rules.
      document: head.document,
      title: detached(head.title),
      description: detached(head.description),
      lang: detached(head.lang),
      alternates: head.alternates.map(({ hreflang, href }) => ({ hreflang: detached(hreflang), href: detached(href) })),
      icons: head.icons.map(detached),
      // Ignore comments are rare, and site-wide rules have to honor them.
      suppressions: this.source.includes("builtcheck-ignore") ? this.suppressions : null,
    };
  }

  get noindex() {
    return ["robots", "googlebot"].some((name) =>
      this.metaElements(name).some((meta) => /\b(noindex|none)\b/i.test(getAttr(meta, "content") ?? "")),
    );
  }

  get redirect() {
    // A refresh with no URL reloads the same page, which is not a redirect.
    return this.all("meta").some(
      (meta) => (getAttr(meta, "http-equiv") ?? "").trim().toLowerCase() === "refresh" && /url\s*=/i.test(getAttr(meta, "content") ?? ""),
    );
  }

  get canonicalHref() {
    const canonical = this.all("link").find((link) => (getAttr(link, "rel") ?? "").trim().toLowerCase() === "canonical");
    return canonical ? getAttr(canonical, "href") : null;
  }

  all(name) {
    return this.byName.get(name) ?? [];
  }

  // Whether an element sits inside a <template>, which the browser does not render or load.
  isInTemplate(element) {
    return this.all("template").some((template) => element.start > template.start && element.start < template.end);
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

  // Connects the page to its stylesheets. Text that a stylesheet always hides stops counting as
  // visible text.
  applyStyles(styles) {
    this.styles = styles;
    this.derived.delete("textRuns");
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
      sources.push({ file: this.file, kind: "block", baseOffset: textNode.start, ...scanCss(textNode.value), element: style, page: this });
    }
    for (const element of this.elements) {
      const attr = element.attrs.get("style");
      if (!attr || attr.value.trim() === "") continue;
      sources.push({ file: this.file, kind: "inline", baseOffset: attr.valueStart, ...scanCss(attr.value), element, page: this });
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
        suppressions.addNextLine(this.source, comment.end, this.lines, directive.rules);
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
          suppressions.addNextLine(this.source, source.baseOffset + comment.end, this.lines, directive.rules);
        } else {
          const from = source.baseOffset + comment.end;
          suppressions.addRange(from, nextRuleEnd(this.source, from), directive.rules);
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
      if (token === "d-none" || /(^|:)(?:hidden|sr-only|visually-hidden|visuallyhidden|screen-reader-text)$/.test(token)) return true;
    }
  }
  return false;
}
