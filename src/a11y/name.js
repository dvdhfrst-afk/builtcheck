// Accessible names, worked out the way the W3C "Accessible Name and Description Computation"
// does for the cases a built page holds: aria-labelledby, aria-label, the element's own
// alternative (alt, a label element, a value, an SVG title), its content for roles named from
// content, and title last. Content hidden from assistive technology does not count, unless the
// element pointed at by aria-labelledby is itself hidden, which is a common and valid way to
// keep a label off screen. CSS generated content is not read, so text that only a stylesheet
// adds does not count; icon fonts, the usual case, add no words anyway.
//
// Every walk here is iterative and aria-labelledby is followed one step only, so a hostile page
// cannot recurse without end.

import { getAttr, normalizeSpace } from "../html/tree.js";
import { explicitRole, tokens } from "./aria.js";
import { elementById, isHiddenFromAssistiveTech, isInTemplate, nearestAncestor, walkWithin } from "./document.js";

const NOT_CONTENT = new Set(["script", "style", "template"]);

// How far a name is read. Names are found in the first few nodes of real markup, and an element
// can hold every other element on a hostile page, so reading is cut off after this many nodes,
// and once it has more text than any message shows. An SVG counts as one node, and is read on a
// budget of its own.
export const MAX_NODES = 300;
const SVG_NODES = 2000;
const ENOUGH_TEXT = 200;
export const UNREAD = "(too large to read)";

// Roles whose name comes from what is inside them.
const NAMED_FROM_CONTENT = new Set([
  "button", "cell", "checkbox", "columnheader", "comment", "gridcell", "heading", "link",
  "menuitem", "menuitemcheckbox", "menuitemradio", "option", "radio", "row", "rowheader",
  "switch", "tab", "tooltip", "treeitem", "doc-backlink", "doc-biblioref", "doc-glossref",
  "doc-noteref",
]);

const LABELABLE = new Set(["button", "input", "meter", "output", "progress", "select", "textarea"]);
const TEXT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number"]);

function attributeText(element, name) {
  const value = getAttr(element, name);
  return value === null ? "" : normalizeSpace(value);
}

export function inputType(element) {
  const type = (getAttr(element, "type") ?? "").trim().toLowerCase();
  return type === "" ? "text" : type;
}

function implicitRoleForContent(element) {
  switch (element.name) {
    case "a":
      return getAttr(element, "href") !== null ? "link" : null;
    case "button":
    case "summary":
      return "button";
    case "td":
      return "cell";
    case "th":
      return "columnheader";
    case "option":
      return "option";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return "heading";
    default:
      return null;
  }
}

function isNamedFromContent(element) {
  return NAMED_FROM_CONTENT.has(explicitRole(element) ?? implicitRoleForContent(element));
}

// The text of the first <title> child, which names an SVG.
function svgTitle(element) {
  const title = element.children.find((child) => child.type === "element" && child.name === "title");
  return title ? contentText(null, title, { includeHidden: true }) : null;
}

// What an SVG inside the element being named adds: its title, or else the words of its text
// elements. Shapes add nothing.
function svgText(element) {
  const title = svgTitle(element);
  if (title !== null) return title;
  const parts = [];
  walkWithin(element, (node) => {
    if (node.type === "text") {
      if (["text", "tspan", "textpath"].includes(node.parent.name)) parts.push(node.value);
      return true;
    }
    return node.type === "element" && !["desc", "metadata", "style", "script"].includes(node.name);
  }, SVG_NODES);
  return normalizeSpace(parts.join(" "));
}

function selectedOptionText(select) {
  const options = [];
  walkWithin(select, (node) => {
    if (node.type === "element" && node.name === "option") options.push(node);
    return node.type === "element" && node.name !== "option";
  }, MAX_NODES);
  const chosen = options.find((option) => option.attrs.has("selected")) ?? options[0];
  return chosen ? attributeText(chosen, "label") || contentText(null, chosen, { includeHidden: true }) : "";
}

// What an element inside the one being named adds in place of its content, or null to read its
// content. `follow` is whether its aria-labelledby is still followed.
function ownText(page, element, follow) {
  if (follow && getAttr(element, "aria-labelledby") !== null) {
    const byIds = labelledByText(page, element);
    if (byIds) return byIds;
  }
  const label = attributeText(element, "aria-label");
  if (label) return label;
  switch (element.name) {
    case "img":
    case "area":
      return element.attrs.has("alt") ? attributeText(element, "alt") : attributeText(element, "title");
    case "input": {
      const type = inputType(element);
      if (type === "image") return attributeText(element, "alt") || attributeText(element, "title");
      if (type === "hidden" || type === "checkbox" || type === "radio" || type === "file") return "";
      return attributeText(element, "value");
    }
    case "select":
      return selectedOptionText(element);
    case "textarea":
      return contentText(page, element, { includeHidden: true });
    case "svg":
      return svgText(element);
    default:
      return null;
  }
}

// The text inside an element, as names read it. `skip` leaves out one element, such as the
// control a label wraps. With no page, hiding is not checked.
export function contentText(page, root, { includeHidden = false, skip = null, follow = false } = {}) {
  const parts = [];
  let length = 0;
  const complete = walkWithin(root, (node) => {
    if (length >= ENOUGH_TEXT) return false;
    if (node === root) return true;
    if (node.type === "text") {
      parts.push(node.value);
      length += node.value.trim().length;
      return true;
    }
    if (node.type !== "element" || node === skip || NOT_CONTENT.has(node.name)) return false;
    if (page && !includeHidden && isHiddenFromAssistiveTech(page, node)) return false;
    const own = page ? ownText(page, node, follow) : null;
    if (own !== null) {
      parts.push(` ${own} `);
      length += own.length;
      return false;
    }
    return true;
  }, MAX_NODES);
  const text = normalizeSpace(parts.join(""));
  // Past the limit the answer is unknown, and an unknown name is not reported as missing.
  return text === "" && !complete ? UNREAD : text;
}

// What an element pointed at by aria-labelledby contributes. Its own aria-labelledby is not
// followed, as the specification says.
function referencedText(page, element) {
  const own = ownText(page, element, false);
  if (own) return own;
  const includeHidden = isHiddenFromAssistiveTech(page, element);
  return contentText(page, element, { includeHidden }) || attributeText(element, "title");
}

function labelledByText(page, element) {
  const parts = [];
  for (const id of tokens(getAttr(element, "aria-labelledby"))) {
    const target = elementById(page, id);
    if (target && target !== element) parts.push(referencedText(page, target));
  }
  return normalizeSpace(parts.join(" "));
}

function labelsByTarget(page) {
  return page.once("a11y:labels", () => {
    const byTarget = new Map();
    for (const label of page.all("label")) {
      const target = getAttr(label, "for");
      if (target === null || isInTemplate(page, label)) continue;
      if (!byTarget.has(target)) byTarget.set(target, []);
      byTarget.get(target).push(label);
    }
    return byTarget;
  });
}

export function isLabelable(element) {
  return LABELABLE.has(element.name) && !(element.name === "input" && inputType(element) === "hidden");
}

// The first labelable element inside a label, which is the control a label without "for" labels.
function firstLabelable(label) {
  let found = null;
  walkWithin(label, (node) => {
    if (found !== null || node.type !== "element") return false;
    if (node !== label && isLabelable(node)) {
      found = node;
      return false;
    }
    return true;
  }, MAX_NODES);
  return found;
}

// The label elements of a form control: those whose "for" names it, and the label around it.
export function labelsOf(page, control) {
  const labels = [];
  const id = getAttr(control, "id");
  if (id && elementById(page, id) === control) {
    for (const label of labelsByTarget(page).get(id) ?? []) labels.push(label);
  }
  const around = nearestAncestor(page, control, "label");
  if (around && getAttr(around, "for") === null && firstLabelable(around) === control) labels.push(around);
  return labels;
}

function labelText(page, control) {
  return normalizeSpace(labelsOf(page, control).map((label) => contentText(page, label, { skip: control, follow: true })).join(" "));
}

// The element's own alternative when it is the one being named.
function nativeName(page, element, { placeholder }) {
  const placeholderText = () => (placeholder ? attributeText(element, "placeholder") : "");
  switch (element.name) {
    case "img":
    case "area":
      return attributeText(element, "alt");
    case "input": {
      const type = inputType(element);
      if (type === "image") return attributeText(element, "alt");
      if (type === "submit" || type === "reset") return attributeText(element, "value") || labelText(page, element) || (type === "submit" ? "Submit" : "Reset");
      if (type === "button") return labelText(page, element) || attributeText(element, "value");
      if (TEXT_TYPES.has(type)) return labelText(page, element) || placeholderText();
      return labelText(page, element);
    }
    case "textarea":
      return labelText(page, element) || placeholderText();
    case "select":
    case "meter":
    case "output":
    case "progress":
      return labelText(page, element);
    case "button":
      return labelText(page, element) || contentText(page, element, { follow: true });
    case "svg":
      return svgTitle(element) ?? "";
    default:
      return isNamedFromContent(element) ? contentText(page, element, { follow: true }) : "";
  }
}

// The accessible name of an element, whitespace collapsed, or "" if it has none. With
// `placeholder: false`, a placeholder does not count as a name.
export function accessibleName(page, element, { placeholder = true } = {}) {
  return (
    labelledByText(page, element) ||
    attributeText(element, "aria-label") ||
    nativeName(page, element, { placeholder }) ||
    attributeText(element, "title")
  );
}
