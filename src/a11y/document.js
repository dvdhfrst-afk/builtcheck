// What a page looks like to assistive technology: which elements it never meets, which ids exist,
// which elements take keyboard focus, and which elements a site owner asked not to check. Hiding
// is decided by the same tests the rest of the tool uses (the hidden attribute, hiding inline
// styles, and the stylesheets the page loads), plus what only assistive technology honors.

import { isHiddenElement } from "../html/page.js";
import { getAttr, hasAttr } from "../html/tree.js";
import { matchesSelector, parseSelectorList } from "../css/selectors.js";
import { ID_REFERENCE_ATTRIBUTES, tokens } from "./aria.js";

// Content a browser does not render for a reader: a template is inert until a script uses it, and
// noscript content is replaced when scripts run, which is how assistive technology meets a page.
const UNRENDERED = new Set(["template", "noscript", "script", "style"]);

function isAriaHidden(element) {
  return (getAttr(element, "aria-hidden") ?? "").trim().toLowerCase() === "true";
}

function notRenderedItself(element) {
  return UNRENDERED.has(element.name) || isHiddenElement(element) || hasAttr(element, "inert");
}

// A value built down the tree from the root, remembered per element so a deep page costs one
// visit per element: `step(valueOfParent, element)` gives the element's own value.
function folded(page, key, element, step) {
  const known = page.once(key, () => new Map());
  const chain = [];
  let node = element;
  while (node && node.type === "element" && !known.has(node)) {
    chain.push(node);
    node = node.parent;
  }
  let value = node && node.type === "element" ? known.get(node) : null;
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    value = step(value, chain[i]);
    known.set(chain[i], value);
  }
  return value;
}

function inherited(page, key, element, test) {
  return folded(page, key, element, (above, node) => Boolean(above) || test(node));
}

// The nearest ancestor of the element, not the element itself, with this tag name, or null.
export function nearestAncestor(page, element, name) {
  const parent = element.parent;
  if (!parent || parent.type !== "element") return null;
  return folded(page, `a11y:in:${name}`, parent, (above, node) => (node.name === name ? node : above));
}

export function isInside(page, element, name) {
  return nearestAncestor(page, element, name) !== null;
}

// Whether the element sits inside a template, which the browser neither renders nor loads.
export function isInTemplate(page, element) {
  return isInside(page, element, "template");
}

// True if the page as built does not render this element at all: nobody sees it, and it cannot
// take focus.
export function isNotRendered(page, element) {
  if (inherited(page, "a11y:unrendered", element, notRenderedItself)) return true;
  return page.styles ? page.styles.isAlwaysHidden(element) : false;
}

// True if assistive technology never meets this element as the page is built.
export function isHiddenFromAssistiveTech(page, element) {
  return ariaHiddenRoot(page, element) !== null || isNotRendered(page, element);
}

// The outermost element marked aria-hidden="true" around this one, itself included, or null.
export function ariaHiddenRoot(page, element) {
  return folded(page, "a11y:aria-hidden", element, (above, node) => above ?? (isAriaHidden(node) ? node : null));
}

// Elements by id, leaving out those inside a template, which are not in the document until a
// script puts them there. Ids that only a template holds are kept apart: a reference to one may
// work once the script has run, so it is not reported as missing.
export function pageIds(page) {
  return page.once("a11y:ids", () => {
    const byId = new Map();
    const inTemplate = new Set();
    for (const element of page.elements) {
      const id = getAttr(element, "id");
      if (!id) continue;
      if (isInTemplate(page, element)) {
        inTemplate.add(id);
        continue;
      }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(element);
    }
    return { byId, inTemplate };
  });
}

export function elementById(page, id) {
  return pageIds(page).byId.get(id)?.[0] ?? null;
}

// Every place on the page that names an element by id: ARIA references and label for.
// Each entry is { element, attribute, id }.
export function idReferences(page, attributes = ID_REFERENCE_ATTRIBUTES) {
  const references = [];
  for (const element of page.elements) {
    for (const attribute of attributes) {
      for (const id of tokens(getAttr(element, attribute))) references.push({ element, attribute, id });
    }
    if (element.name === "label") {
      const id = getAttr(element, "for");
      if (id !== null && id.trim() !== "") references.push({ element, attribute: "for", id });
    }
  }
  return references.filter(({ element }) => !isInTemplate(page, element));
}

// The integer a tabindex attribute holds, read the way HTML reads it, or null.
export function tabIndex(element) {
  const value = getAttr(element, "tabindex");
  if (value === null) return null;
  const match = /^\s*([-+]?\d+)/.exec(value);
  return match ? Number(match[1]) : null;
}

const DISABLEABLE = new Set(["button", "input", "select", "textarea"]);

// A disabled control, or one inside a disabled fieldset. A fieldset's first legend stays usable,
// but that is too rare to be worth the cost here.
function isDisabled(page, element) {
  if (!DISABLEABLE.has(element.name)) return false;
  if (hasAttr(element, "disabled")) return true;
  return inherited(page, "a11y:disabled-fieldset", element, (node) => node.name === "fieldset" && hasAttr(node, "disabled"));
}

// True if the element is reached with the Tab key: focusable, and not taken out of the order
// with a negative tabindex.
export function isTabbable(page, element) {
  const index = tabIndex(element);
  if (index !== null && index < 0) return false;
  if (isDisabled(page, element)) return false;
  if (index !== null) return true;
  switch (element.name) {
    case "a":
    case "area":
      return hasAttr(element, "href");
    case "button":
    case "select":
    case "textarea":
    case "iframe":
      return true;
    case "input":
      return (getAttr(element, "type") ?? "").trim().toLowerCase() !== "hidden";
    case "audio":
    case "video":
      return hasAttr(element, "controls");
    case "summary":
      return element.parent?.name === "details" && element.parent.children.find((child) => child.type === "element") === element;
    default: {
      const editable = getAttr(element, "contenteditable");
      return editable !== null && editable.trim().toLowerCase() !== "false";
    }
  }
}

// A pre-order walk like walk() in the tree module that gives up after `limit` nodes, so a check
// run on each of many nested elements cannot cost the square of the page. Returns false if it
// gave up.
export function walkWithin(root, visit, limit) {
  const pending = [root];
  let visited = 0;
  while (pending.length > 0) {
    if (visited >= limit) return false;
    visited += 1;
    const current = pending.pop();
    if (visit(current) === false) continue;
    const { children } = current;
    if (children) {
      for (let i = children.length - 1; i >= 0; i -= 1) pending.push(children[i]);
    }
  }
  return true;
}

// Turns the ignoreSelectors option into parsed selectors. A selector this tool cannot read would
// match every element, which would silently turn the rule off, so it is refused instead.
export function compileSelectors(list) {
  return list.flatMap((text) => {
    const parsed = parseSelectorList(text);
    const unreadable = parsed.find((complex) => complex.unparsed || complex.pseudoElement !== null);
    if (unreadable || parsed.length === 0) throw new Error(`ignoreSelectors: "${text}" is not a selector this tool can read`);
    return parsed;
  });
}

// True if the element or one of its ancestors matches one of the selectors.
export function isIgnored(element, selectors) {
  if (selectors.length === 0) return false;
  for (let node = element; node && node.type === "element"; node = node.parent) {
    if (selectors.some((complex) => matchesSelector(node, complex))) return true;
  }
  return false;
}
