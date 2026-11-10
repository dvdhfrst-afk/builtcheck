// What WAI-ARIA defines: its roles, its states and properties, and which properties name other
// elements by id. The lists are WAI-ARIA 1.2, with the additions of the 1.3 draft, the Digital
// Publishing roles and the Graphics roles, since a valid page may use any of them and a false
// "unknown role" would cost more trust than missing a rare typo.

const ROLES_1_2 = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption",
  "cell", "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo",
  "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure",
  "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion", "link", "list",
  "listbox", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none", "note", "option",
  "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup",
  "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status",
  "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term",
  "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
];

const ROLES_1_3 = ["comment", "image", "mark", "suggestion"];

const DIGITAL_PUBLISHING_ROLES = [
  "abstract", "acknowledgments", "afterword", "appendix", "backlink", "biblioentry",
  "bibliography", "biblioref", "chapter", "colophon", "conclusion", "cover", "credit", "credits",
  "dedication", "endnote", "endnotes", "epigraph", "epilogue", "errata", "example", "footnote",
  "foreword", "glossary", "glossref", "index", "introduction", "noteref", "notice", "pagebreak",
  "pagefooter", "pageheader", "pagelist", "part", "preface", "prologue", "pullquote", "qna",
  "subtitle", "tip", "toc",
].map((name) => `doc-${name}`);

const GRAPHICS_ROLES = ["graphics-document", "graphics-object", "graphics-symbol"];

export const ROLES = new Set([...ROLES_1_2, ...ROLES_1_3, ...DIGITAL_PUBLISHING_ROLES, ...GRAPHICS_ROLES]);

// Roles that exist only to organize the specification. Authors must not use them.
export const ABSTRACT_ROLES = new Set([
  "command", "composite", "input", "landmark", "range", "roletype", "section", "sectionhead",
  "select", "structure", "widget", "window",
]);

const ATTRIBUTES_1_2 = [
  "activedescendant", "atomic", "autocomplete", "busy", "checked", "colcount", "colindex",
  "colspan", "controls", "current", "describedby", "details", "disabled", "dropeffect",
  "errormessage", "expanded", "flowto", "grabbed", "haspopup", "hidden", "invalid",
  "keyshortcuts", "label", "labelledby", "level", "live", "modal", "multiline",
  "multiselectable", "orientation", "owns", "placeholder", "posinset", "pressed", "readonly",
  "relevant", "required", "roledescription", "rowcount", "rowindex", "rowspan", "selected",
  "setsize", "sort", "valuemax", "valuemin", "valuenow", "valuetext",
];

const ATTRIBUTES_1_3 = ["braillelabel", "brailleroledescription", "colindextext", "description", "rowindextext"];

export const ARIA_ATTRIBUTES = new Set([...ATTRIBUTES_1_2, ...ATTRIBUTES_1_3].map((name) => `aria-${name}`));

// Properties whose value is one id or a list of ids on the same page.
export const ID_REFERENCE_ATTRIBUTES = [
  "aria-activedescendant", "aria-controls", "aria-describedby", "aria-details",
  "aria-errormessage", "aria-flowto", "aria-labelledby", "aria-owns",
];

export function tokens(value) {
  return value === null ? [] : value.trim().split(/\s+/).filter(Boolean);
}

// The role an element takes from its role attribute: the first token a browser knows, as the
// attribute is a list of fallbacks. Null when it has none.
export function explicitRole(element) {
  const value = element.attrs.get("role");
  if (!value) return null;
  for (const token of tokens(value.value)) {
    const role = token.toLowerCase();
    if (ROLES.has(role)) return role;
  }
  return null;
}

// What an element is to assistive technology, as far as the rules here need to know. A role
// attribute wins; otherwise the element's own meaning, for the elements the rules ask about.
export function roleOf(element) {
  const role = explicitRole(element);
  if (role === "image") return "img";
  if (role !== null) return role;
  switch (element.name) {
    case "a":
    case "area":
      return element.attrs.has("href") ? "link" : null;
    case "button":
      return "button";
    case "h1": case "h2": case "h3": case "h4": case "h5": case "h6":
      return "heading";
    case "main":
      return "main";
    case "img":
      return "img";
    default:
      return null;
  }
}

// Edit distance, to suggest the attribute a typo meant.
export function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// The candidate a typo most likely meant, within `limit` edits, or null. Long words are not
// compared: no real name is that long, and the comparison costs the product of the lengths.
export function closest(word, candidates, limit = 2) {
  if (word.length > 64) return null;
  let best = null;
  let bestDistance = limit + 1;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - word.length) > limit) continue;
    const distance = editDistance(word, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
