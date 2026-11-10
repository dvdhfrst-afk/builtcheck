// Accessibility rules: what a screen reader, a keyboard or a voice control user meets in the
// built markup. Two kinds of check live here. Checks of what is announced (names, alt text,
// headings, landmarks, media) skip content that assistive technology never meets as the page is
// built: aria-hidden, the hidden attribute, hiding styles and stylesheets, template and noscript.
// Checks of whether the markup is valid (roles, attributes, references, scope, autocomplete) skip
// only templates, since invalid markup stays invalid when a script shows it.

import { ancestors, getAttr, hasAttr, normalizeSpace, walk } from "../html/tree.js";
import { autocompleteProblem } from "../a11y/autocomplete.js";
import {
  ABSTRACT_ROLES, ARIA_ATTRIBUTES, ID_REFERENCE_ATTRIBUTES, ROLES, closest, explicitRole, roleOf, tokens,
} from "../a11y/aria.js";
import {
  ariaHiddenRoot, compileSelectors, idReferences, isHiddenFromAssistiveTech, isIgnored, isInside, isNotRendered,
  isInTemplate, isTabbable, pageIds, tabIndex, walkWithin,
} from "../a11y/document.js";
import { MAX_NODES, accessibleName, inputType, isLabelable } from "../a11y/name.js";

const compiledSelectors = new WeakMap();

function ignoredSelectors(options) {
  if (!compiledSelectors.has(options)) compiledSelectors.set(options, compileSelectors(options.ignoreSelectors ?? []));
  return compiledSelectors.get(options);
}

function validateSelectors(options) {
  compileSelectors(options.ignoreSelectors ?? []);
}

// Whether an announcement check looks at this element.
function isAnnounced(page, element, options) {
  return !isHiddenFromAssistiveTech(page, element) && !isIgnored(element, ignoredSelectors(options));
}

// Whether a markup check looks at this element.
function isInMarkup(page, element, options) {
  return !isInTemplate(page, element) && !isIgnored(element, ignoredSelectors(options));
}

function shorten(text, length = 60) {
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

const SHOWN_ATTRIBUTES = ["type", "id", "name", "class", "href", "src"];

// A short form of an element's start tag, such as <input type="email" name="email">, so a
// finding can be told apart from others on the same line.
function tag(element) {
  const shown = [];
  for (const name of SHOWN_ATTRIBUTES) {
    const value = getAttr(element, name);
    if (value === null || value.trim() === "") continue;
    shown.push(` ${name}="${shorten(normalizeSpace(value), 40)}"`);
    if (shown.length === 2) break;
  }
  return `<${element.name}${shown.join("")}>`;
}

function lineOf(page, element) {
  return page.lines.locate(element.start).line;
}

// Pages with no document of their own: a redirect stub, or a fragment such as a site
// verification file.
function isStructuredPage(page) {
  if (page.redirect) return false;
  return page.first("html") !== null || page.first("head") !== null || page.first("body") !== null;
}

const IGNORE_SELECTORS = { ignoreSelectors: [] };

// An image with no alt attribute and nothing else to name it. One marked as presentation is
// decorative, which is what alt="" would have said.
function lacksAlt(page, img) {
  if (img.attrs.has("alt") || ["presentation", "none"].includes(explicitRole(img))) return false;
  return accessibleName(page, img) === "";
}

const imageAlt = {
  id: "a11y/image-alt",
  severity: "error",
  description: 'An image, image button or image map area has no alt text. Decorative images need alt="".',
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const img of page.all("img")) {
      if (!lacksAlt(page, img) || !isAnnounced(page, img, options)) continue;
      const src = getAttr(img, "src") ?? getAttr(img, "srcset") ?? "";
      const which = src.trim() ? `Image ${shorten(src.trim())}` : `Image ${tag(img)}`;
      report({ file: page.file, offset: img.start, message: `${which} has no alt attribute. Describe it in alt, or write alt="" if it is decorative` });
    }
    for (const input of page.all("input")) {
      if (inputType(input) !== "image" || !isAnnounced(page, input, options)) continue;
      if (accessibleName(page, input) === "") {
        report({ file: page.file, offset: input.start, message: `Image button ${tag(input)} has no alt text, so its action is not announced` });
      }
    }
    for (const area of page.all("area")) {
      if (!area.attrs.has("href") || !isAnnounced(page, area, options)) continue;
      if (accessibleName(page, area) === "") {
        report({ file: page.file, offset: area.start, message: `Image map area linking to ${shorten(getAttr(area, "href"))} has no alt text` });
      }
    }
  },
};

const IMAGE_FILE = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|ico)$/i;
// The names cameras and phones give files, such as IMG_2041 or PXL_20260101_093000.
const CAMERA_NAME = /^(?:img|image|dsc|dscn|dscf|pxl|screenshot|photo)[-_ ]?\d[\d_ -]*$/i;

function fileStem(src) {
  const path = src.split(/[?#]/)[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.[a-z0-9]+$/i, "").toLowerCase();
}

// Why alt text is a stand-in rather than a description, or null.
function placeholderAltProblem(alt, src, placeholders) {
  const text = normalizeSpace(alt);
  if (text === "") return null;
  if (IMAGE_FILE.test(text) || CAMERA_NAME.test(text)) return "a file name";
  const stem = src ? fileStem(src) : "";
  if (stem !== "" && text.toLowerCase() === stem && /[-_\d]/.test(stem)) return "the file name";
  const bare = text.toLowerCase().replace(/[.:!]+$/, "").trim();
  return placeholders.includes(bare) ? "a placeholder" : null;
}

const placeholderAlt = {
  id: "a11y/placeholder-alt",
  severity: "warning",
  description: 'Alt text is a file name or a placeholder such as "image", so it describes nothing.',
  options: {
    placeholders: [
      "image", "img", "photo", "picture", "graphic", "icon", "placeholder", "untitled", "alt",
      "alt text", "image alt", "alt tag", "spacer", "blank", "insert alt text", "image description",
    ],
    ...IGNORE_SELECTORS,
  },
  validate: validateSelectors,
  page(page, { options, report }) {
    const placeholders = options.placeholders.map((entry) => entry.toLowerCase());
    const candidates = [...page.all("img"), ...page.all("area"), ...page.all("input").filter((input) => inputType(input) === "image")];
    for (const element of candidates) {
      const alt = getAttr(element, "alt");
      if (alt === null || !isAnnounced(page, element, options)) continue;
      const problem = placeholderAltProblem(alt, getAttr(element, "src"), placeholders);
      if (problem) {
        report({ file: page.file, offset: element.start, message: `Alt text "${shorten(normalizeSpace(alt))}" is ${problem}, not a description of the image` });
      }
    }
  },
};

// Roles of form fields built from other elements, which only ARIA can name.
const FIELD_ROLES = new Set([
  "checkbox", "combobox", "listbox", "menuitemcheckbox", "menuitemradio", "radio", "searchbox",
  "slider", "spinbutton", "switch", "textbox",
]);
const NOT_FIELD_INPUTS = new Set(["hidden", "submit", "reset", "button", "image"]);

function formFields(page) {
  const fields = [];
  for (const element of page.elements) {
    if (element.name === "input") {
      if (!NOT_FIELD_INPUTS.has(inputType(element))) fields.push(element);
    } else if (element.name === "select" || element.name === "textarea") {
      fields.push(element);
    } else if (element.name !== "button" && FIELD_ROLES.has(explicitRole(element))) {
      fields.push(element);
    }
  }
  return fields;
}

const controlName = {
  id: "a11y/control-name",
  severity: "error",
  description: "A form field has no accessible name: no label, aria-label or aria-labelledby.",
  options: { allowPlaceholder: true, ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const field of formFields(page)) {
      if (!isAnnounced(page, field, options)) continue;
      if (accessibleName(page, field, { placeholder: options.allowPlaceholder }) !== "") continue;
      const placeholder = normalizeSpace(getAttr(field, "placeholder") ?? "");
      const message = placeholder !== "" && !options.allowPlaceholder
        ? `Form field ${tag(field)} has only a placeholder ("${shorten(placeholder, 40)}"), which disappears once someone types. Add a <label>`
        : `Form field ${tag(field)} has no label. Add a <label>, an aria-label or aria-labelledby`;
      report({ file: page.file, offset: field.start, message });
    }
  },
};

const labelFor = {
  id: "a11y/label-for",
  severity: "error",
  description: "A label's for attribute names an id that is not on the page, or an element a label cannot label.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    const { byId, inTemplate } = pageIds(page);
    let fields = null;
    const guesses = new Map();
    for (const label of page.all("label")) {
      const id = getAttr(label, "for");
      if (id === null || id.trim() === "" || !isInMarkup(page, label, options)) continue;
      const target = byId.get(id)?.[0];
      if (target === undefined) {
        if (inTemplate.has(id)) continue;
        // The ids of the fields on the page are the likely meaning of a mistyped one. Past a few
        // hundred of them, or of broken labels, a guess is not worth the time.
        fields ??= [...byId.entries()].filter(([, elements]) => isLabelable(elements[0])).map(([candidate]) => candidate).slice(0, 500);
        if (!guesses.has(id)) guesses.set(id, guesses.size < 100 ? closest(id, fields) : null);
        const guess = guesses.get(id);
        const hint = guess ? ` Did you mean "${guess}"?` : "";
        report({ file: page.file, offset: label.start, message: `<label for="${shorten(id, 40)}"> names an id that is not on this page, so it labels nothing.${hint}` });
      } else if (!isLabelable(target) && !target.name.includes("-")) {
        report({ file: page.file, offset: label.start, message: `<label for="${shorten(id, 40)}"> points at ${tag(target)}, which a label cannot label` });
      }
    }
  },
};

// An image inside the element that image-alt already reports, so one missing alt is not
// reported twice.
function holdsImageReportedElsewhere(page, element, site) {
  if (site.config.rules[imageAlt.id].severity === "off") return false;
  let found = false;
  walkWithin(element, (node) => {
    if (found || node.type !== "element") return false;
    if (node !== element && isHiddenFromAssistiveTech(page, node)) return false;
    if (node.name === "img" && lacksAlt(page, node)) found = true;
    return true;
  }, MAX_NODES);
  return found;
}

function linkTarget(element) {
  const href = getAttr(element, "href");
  return href === null ? "" : ` to ${shorten(href.trim() || '""')}`;
}

const linkName = {
  id: "a11y/link-name",
  severity: "error",
  description: "A link has no accessible name, such as an icon-only link with no label.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { site, options, report }) {
    for (const element of page.elements) {
      // Image map areas are image-alt's to report.
      if (roleOf(element) !== "link" || element.name === "area" || isInside(page, element, "svg") || isInside(page, element, "math") || !isAnnounced(page, element, options)) continue;
      if (accessibleName(page, element) !== "" || holdsImageReportedElsewhere(page, element, site)) continue;
      const what = element.name === "a" ? `Link${linkTarget(element)}` : `${tag(element)} with role="link"`;
      report({ file: page.file, offset: element.start, message: `${what} has no text a screen reader can announce. Add text, an aria-label, or alt text on its image` });
    }
  },
};

const BUTTON_INPUTS = new Set(["button", "submit", "reset"]);

const buttonName = {
  id: "a11y/button-name",
  severity: "error",
  description: "A button has no accessible name, such as an icon-only button with no label.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { site, options, report }) {
    for (const element of page.elements) {
      const isButton = element.name === "input" ? BUTTON_INPUTS.has(inputType(element)) && explicitRole(element) === null : roleOf(element) === "button";
      if (!isButton || isInside(page, element, "svg") || isInside(page, element, "math") || !isAnnounced(page, element, options)) continue;
      if (accessibleName(page, element) !== "" || holdsImageReportedElsewhere(page, element, site)) continue;
      report({ file: page.file, offset: element.start, message: `Button ${tag(element)} has no text a screen reader can announce. Add text or an aria-label` });
    }
  },
};

const ariaReference = {
  id: "a11y/aria-reference",
  severity: "error",
  description: "An ARIA attribute such as aria-labelledby or aria-controls names an id that is not on the page.",
  options: { attributes: [...ID_REFERENCE_ATTRIBUTES], ...IGNORE_SELECTORS },
  validate(options) {
    for (const attribute of options.attributes) {
      if (!ID_REFERENCE_ATTRIBUTES.includes(attribute)) {
        throw new Error(`attributes: ${attribute} does not name an element by id. Known: ${ID_REFERENCE_ATTRIBUTES.join(", ")}`);
      }
    }
    validateSelectors(options);
  },
  page(page, { options, report }) {
    const { byId, inTemplate } = pageIds(page);
    for (const { element, attribute, id } of idReferences(page, options.attributes)) {
      if (attribute === "for" || byId.has(id) || inTemplate.has(id) || !isInMarkup(page, element, options)) continue;
      report({ file: page.file, offset: element.start, message: `${attribute} on ${tag(element)} names the id "${shorten(id, 40)}", which is not on this page` });
    }
  },
};

const duplicateId = {
  id: "a11y/duplicate-id",
  severity: "error",
  description: "An id that a label or an ARIA attribute depends on is on more than one element, so only the first one counts.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    const { byId } = pageIds(page);
    const reported = new Set();
    for (const { element, attribute, id } of idReferences(page)) {
      const elements = byId.get(id);
      if (!elements || elements.length < 2 || reported.has(id) || !isInMarkup(page, element, options)) continue;
      reported.add(id);
      report({
        file: page.file,
        offset: elements[1].start,
        message: `The id "${shorten(id, 40)}" is on ${elements.length} elements, and the ${attribute} on line ${lineOf(page, element)} depends on it. Only the first one, on line ${lineOf(page, elements[0])}, counts`,
      });
    }
  },
};

const ariaRole = {
  id: "a11y/aria-role",
  severity: "error",
  description: "A role attribute holds no WAI-ARIA role, or an abstract one that pages must not use.",
  options: { allowRoles: [], ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    const allowed = new Set(options.allowRoles.map((role) => role.toLowerCase()));
    for (const element of page.elements) {
      const value = getAttr(element, "role");
      if (value === null || value.trim() === "") continue;
      const roles = tokens(value).map((role) => role.toLowerCase());
      if (roles.some((role) => ROLES.has(role) || allowed.has(role)) || !isInMarkup(page, element, options)) continue;
      const first = roles[0];
      let message;
      if (ABSTRACT_ROLES.has(first)) {
        message = `role="${shorten(value.trim(), 40)}" on ${tag(element)} is an abstract role, which only organizes the ARIA specification. Use a concrete role`;
      } else {
        const guess = closest(first, ROLES);
        message = `role="${shorten(value.trim(), 40)}" on ${tag(element)} is not a WAI-ARIA role, so it is ignored.${guess ? ` Did you mean "${guess}"?` : ""}`;
      }
      report({ file: page.file, offset: element.start, message });
    }
  },
};

const ariaAttribute = {
  id: "a11y/aria-attribute",
  severity: "error",
  description: "An aria-* attribute that WAI-ARIA does not define, usually a misspelling, so it does nothing.",
  options: { allowAttributes: [], ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    const allowed = new Set(options.allowAttributes.map((name) => name.toLowerCase()));
    for (const element of page.elements) {
      for (const [name, attr] of element.attrs) {
        if (!name.startsWith("aria-") || ARIA_ATTRIBUTES.has(name) || allowed.has(name)) continue;
        if (!isInMarkup(page, element, options)) break;
        const guess = closest(name, ARIA_ATTRIBUTES);
        report({ file: page.file, offset: attr.start, message: `${name} is not an ARIA attribute, so it does nothing.${guess ? ` Did you mean ${guess}?` : ""}` });
      }
    }
  },
};

function focusableKind(element) {
  if (roleOf(element) === "link") return "link";
  if (element.name === "button" || roleOf(element) === "button") return "button";
  if (["input", "select", "textarea"].includes(element.name)) return "form field";
  return `<${element.name}>`;
}

const hiddenFocusable = {
  id: "a11y/hidden-focusable",
  severity: "error",
  description: 'Content inside aria-hidden="true" can still take keyboard focus, so keyboard users land on something screen readers do not announce.',
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    const byRoot = new Map();
    for (const element of page.elements) {
      if (!isTabbable(page, element)) continue;
      const root = ariaHiddenRoot(page, element);
      if (root === null || isNotRendered(page, element) || isIgnored(element, ignoredSelectors(options))) continue;
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(element);
    }
    for (const [root, elements] of byRoot) {
      const [first] = elements;
      const name = accessibleName(page, first);
      const example = `${focusableKind(first)}${name ? ` "${shorten(name, 40)}"` : ""} on line ${lineOf(page, first)}`;
      const count = elements.length === 1 ? `an element that can still take keyboard focus: the ${example}` : `${elements.length} elements that can still take keyboard focus, such as the ${example}`;
      report({
        file: page.file,
        offset: root.start,
        message: `aria-hidden="true" on ${tag(root)} hides ${count}. Add tabindex="-1" to them, or use inert instead of aria-hidden`,
      });
    }
  },
};

const positiveTabindex = {
  id: "a11y/positive-tabindex",
  severity: "warning",
  description: "A tabindex above 0 moves an element ahead of the page order for keyboard users.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const element of page.elements) {
      const index = tabIndex(element);
      if (index === null || index <= 0 || !isInMarkup(page, element, options)) continue;
      report({
        file: page.file,
        offset: element.start,
        message: `tabindex="${index}" on ${tag(element)} makes keyboard focus jump out of reading order. Use tabindex="0" and order the markup instead`,
      });
    }
  },
};

// The level of a heading as assistive technology reads it, or null if it is not a heading.
function headingLevel(element) {
  const role = explicitRole(element);
  const isNative = /^h[1-6]$/.test(element.name);
  if (role !== null && role !== "heading") return null;
  if (!isNative && role !== "heading") return null;
  const level = /^\s*(\d+)\s*$/.exec(getAttr(element, "aria-level") ?? "");
  if (level && Number(level[1]) >= 1) return Number(level[1]);
  return isNative ? Number(element.name[1]) : 2;
}

function levelName(element, level) {
  return /^h[1-6]$/.test(element.name) && Number(element.name[1]) === level ? `h${level}` : `level ${level}`;
}

const headingOrder = {
  id: "a11y/heading-order",
  severity: "warning",
  description: "A heading skips a level, such as an h4 straight after an h2, which breaks the outline screen reader users navigate by.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    let previous = null;
    for (const element of page.elements) {
      const level = headingLevel(element);
      if (level === null || !isAnnounced(page, element, options)) continue;
      const name = accessibleName(page, element);
      if (name === "") continue;
      if (previous !== null && level > previous.level + 1) {
        report({
          file: page.file,
          offset: element.start,
          message: `Heading "${shorten(name, 50)}" skips from ${levelName(previous.element, previous.level)} to ${levelName(element, level)}. Use the next level down, and style it as you like`,
        });
      }
      previous = { element, level };
    }
  },
};

const frameTitle = {
  id: "a11y/frame-title",
  severity: "error",
  description: "An iframe has no title, so screen readers cannot say what it holds.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const frame of [...page.all("iframe"), ...page.all("frame")]) {
      if (!isAnnounced(page, frame, options) || accessibleName(page, frame) !== "") continue;
      report({ file: page.file, offset: frame.start, message: `${tag(frame)} has no title. Add a title that says what it shows, such as "Map of our location"` });
    }
  },
};

const TRACK_KINDS = ["captions", "subtitles", "descriptions", "chapters", "metadata"];

// A track's kind, with the defaults HTML gives a missing or unknown value.
function trackKind(track) {
  const value = getAttr(track, "kind");
  if (value === null) return "subtitles";
  const kind = value.trim().toLowerCase();
  return TRACK_KINDS.includes(kind) ? kind : "metadata";
}

// Sources and tracks are children of the media element.
function childrenNamed(element, name) {
  return element.children.filter((child) => child.type === "element" && child.name === name);
}

const videoCaptions = {
  id: "a11y/video-captions",
  severity: "warning",
  description: "A video has no captions track for people who cannot hear it.",
  options: { trackKinds: ["captions", "subtitles"], ignoreMuted: true, ...IGNORE_SELECTORS },
  validate(options) {
    for (const kind of options.trackKinds) {
      if (!TRACK_KINDS.includes(kind)) throw new Error(`trackKinds: "${kind}" is not a track kind. Known: ${TRACK_KINDS.join(", ")}`);
    }
    validateSelectors(options);
  },
  page(page, { options, report }) {
    for (const video of page.all("video")) {
      if (options.ignoreMuted && hasAttr(video, "muted")) continue;
      // With no source in the markup, a script loads the video and usually its captions too.
      if (getAttr(video, "src") === null && childrenNamed(video, "source").length === 0) continue;
      if (!isAnnounced(page, video, options)) continue;
      if (childrenNamed(video, "track").some((track) => options.trackKinds.includes(trackKind(track)))) continue;
      report({ file: page.file, offset: video.start, message: `${tag(video)} has no captions track. Add <track kind="captions"> for people who cannot hear it` });
    }
  },
};

const autoplayAudio = {
  id: "a11y/autoplay-audio",
  severity: "warning",
  description: "Audio or video starts playing sound by itself, which talks over a screen reader.",
  options: { allowWithControls: true, ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const media of [...page.all("audio"), ...page.all("video")]) {
      if (!hasAttr(media, "autoplay") || hasAttr(media, "muted")) continue;
      if (options.allowWithControls && hasAttr(media, "controls")) continue;
      // Hiding a player does not silence it, so only content that never plays is skipped.
      if (isInside(page, media, "noscript") || !isInMarkup(page, media, options)) continue;
      report({ file: page.file, offset: media.start, message: `${tag(media)} plays sound by itself, with no controls to stop it. Add muted, or let people start it` });
    }
  },
};

const htmlLang = {
  id: "a11y/html-lang",
  severity: "error",
  description: "The html element has no lang attribute, so screen readers may read the page in the wrong language.",
  page(page, { report }) {
    if (!isStructuredPage(page)) return;
    const html = page.first("html");
    if (html && (hasAttr(html, "lang") || hasAttr(html, "xml:lang"))) return;
    report({
      file: page.file,
      offset: html ? html.start : null,
      message: html ? "The html element has no lang attribute, so screen readers may read the page in the wrong language" : "The page has no html element with a lang attribute, so screen readers may read it in the wrong language",
    });
  },
};

function hasReadableContent(page) {
  return page.textRuns.some((run) => run.parent.name !== "title");
}

// The first banner or navigation block, which is what a reader needs a way past.
function firstNavigationBlock(page) {
  return page.elements.find((element) => {
    let role = explicitRole(element);
    if (role === null && element.name === "nav") role = "navigation";
    if (role === null && element.name === "header") {
      // A header inside a section belongs to that section, and is no banner.
      const scoped = ancestors(element).some((node) => ["article", "aside", "main", "nav", "section"].includes(node.name));
      if (!scoped) role = "banner";
    }
    return (role === "navigation" || role === "banner") && !isHiddenFromAssistiveTech(page, element);
  });
}

// Whether a reader can get past a navigation block without a main landmark: there is nothing
// after it to get to, or there is a heading after it, or a skip link to somewhere after it. Each
// meets "bypass blocks", WCAG 2.4.1.
function hasBypass(page, block) {
  if (!page.textRuns.some((run) => run.start >= block.end && run.parent.name !== "title")) return true;
  const headingAfter = page.elements.some((element) => element.start >= block.end && headingLevel(element) !== null && !isHiddenFromAssistiveTech(page, element));
  if (headingAfter) return true;
  const { byId } = pageIds(page);
  return page.all("a").some((link) => {
    const href = (getAttr(link, "href") ?? "").trim();
    if (!href.startsWith("#") || href.length < 2) return false;
    const target = byId.get(decodeFragment(href.slice(1)))?.[0];
    return target !== undefined && target.start >= block.end;
  });
}

function decodeFragment(fragment) {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

const mainLandmark = {
  id: "a11y/main-landmark",
  severity: "warning",
  description: "A page has more than one visible main landmark, or has navigation with no main landmark, heading or skip link after it.",
  options: { requireMain: false },
  page(page, { options, report }) {
    if (!isStructuredPage(page) || !hasReadableContent(page)) return;
    const mains = page.elements.filter((element) => roleOf(element) === "main" && !isHiddenFromAssistiveTech(page, element));
    if (mains.length === 0) {
      const body = page.first("body");
      const offset = body ? body.start : null;
      if (options.requireMain) {
        report({ file: page.file, offset, message: "The page has no <main> element. Wrap the main content in <main> so screen reader users can jump to it" });
        return;
      }
      const block = firstNavigationBlock(page);
      if (block && !hasBypass(page, block)) {
        report({
          file: page.file,
          offset: block.start,
          message: `The page has ${block.name === "nav" ? "navigation" : `a <${block.name}> block`} but no <main> element, heading or skip link after it, so keyboard and screen reader users cannot jump past it. Wrap the content in <main>`,
        });
      }
      return;
    }
    const shown = mains.filter((element) => !(page.styles?.isSometimesHidden(element)));
    if (shown.length > 1) {
      report({
        file: page.file,
        offset: shown[1].start,
        message: `The page has ${shown.length} visible main landmarks, and this is the second; the first is on line ${lineOf(page, shown[0])}. A page has one`,
      });
    }
  },
};

// The rows and cells of a table, leaving out those of tables inside it.
function tableShape(table) {
  const rows = [];
  let nested = false;
  let headers = 0;
  walk(table, (node) => {
    if (node.type !== "element") return false;
    if (node === table) return true;
    if (node.name === "table") {
      nested = true;
      return false;
    }
    if (node.name === "tr") rows.push(node.children.filter((child) => child.type === "element" && (child.name === "td" || child.name === "th")));
    const role = explicitRole(node);
    if (node.name === "th" ? role === null || role === "columnheader" || role === "rowheader" : role === "columnheader" || role === "rowheader") headers += 1;
    return true;
  });
  return { rows, nested, headers };
}

const tableHeaders = {
  id: "a11y/table-headers",
  severity: "warning",
  description: "A data table has no header cells, so screen readers read each cell without its heading.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const table of page.all("table")) {
      const role = explicitRole(table);
      if ((role !== null && role !== "table") || isInside(page, table, "table") || !isAnnounced(page, table, options)) continue;
      const { rows, nested, headers } = tableShape(table);
      const columns = rows.reduce((most, cells) => Math.max(most, cells.length), 0);
      // A table holding another table, or a single row or column, is laid out rather than read.
      if (headers > 0 || nested || rows.length < 2 || columns < 2) continue;
      report({
        file: page.file,
        offset: table.start,
        message: `Table with ${rows.length} rows and ${columns} columns has no header cells. Mark its headings with <th>, or add role="presentation" if it only lays out content`,
      });
    }
  },
};

const SCOPES = new Set(["row", "col", "rowgroup", "colgroup"]);

const thScope = {
  id: "a11y/th-scope",
  severity: "error",
  description: "A header cell has a scope value that is not row, col, rowgroup or colgroup, so it is ignored.",
  options: { ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    for (const th of page.all("th")) {
      const scope = getAttr(th, "scope");
      if (scope === null || scope.trim() === "" || SCOPES.has(scope.trim().toLowerCase()) || !isInMarkup(page, th, options)) continue;
      report({ file: page.file, offset: th.start, message: `scope="${shorten(scope.trim(), 30)}" on a header cell is not valid, so it is ignored. Use row, col, rowgroup or colgroup` });
    }
  },
};

// Input types that take an autocomplete field name. The rest, such as checkboxes, do not.
const AUTOFILL_TYPES = new Set([
  "text", "search", "url", "tel", "email", "password", "date", "month", "week", "time",
  "datetime-local", "number", "range", "color",
]);

const autocomplete = {
  id: "a11y/autocomplete",
  severity: "warning",
  description: "An autocomplete value is not a valid token, so browsers cannot fill the field and assistive technology cannot say what it is for.",
  options: { allowValues: [], ...IGNORE_SELECTORS },
  validate: validateSelectors,
  page(page, { options, report }) {
    const allowed = new Set(options.allowValues.map((value) => normalizeSpace(value).toLowerCase()));
    for (const element of page.elements) {
      const value = getAttr(element, "autocomplete");
      if (value === null || allowed.has(normalizeSpace(value).toLowerCase())) continue;
      let problem;
      if (element.name === "form") {
        const word = value.trim().toLowerCase();
        problem = word === "" || word === "on" || word === "off" ? null : "a form takes only \"on\" or \"off\"";
      } else if (element.name === "select" || element.name === "textarea" || (element.name === "input" && AUTOFILL_TYPES.has(inputType(element)))) {
        problem = autocompleteProblem(value);
      } else {
        continue;
      }
      if (problem === null || !isInMarkup(page, element, options)) continue;
      report({ file: page.file, offset: element.start, message: `autocomplete="${shorten(value.trim(), 40)}" on ${tag(element)} is not valid: ${problem}` });
    }
  },
};

// Twenty hours: a page that waits that long before it moves is not time-limited in practice.
const LONGEST_LIMIT = 20 * 60 * 60;

// The delay and target of a refresh, read as HTML reads the content attribute, or null.
export function parseRefresh(content) {
  const match = /^\s*(\d+)(?:\.[\d.]*)?\s*(?:[;,\s]\s*(?:url\s*=\s*)?(.*))?$/is.exec(content);
  if (!match) return null;
  const target = (match[2] ?? "").trim().replace(/^(['"])(.*)\1$/s, "$2").trim();
  return { delay: Number(match[1]), url: target === "" ? null : target };
}

const metaRefresh = {
  id: "a11y/meta-refresh",
  severity: "error",
  description: "A meta refresh moves people to another page, or reloads this one, after a delay they did not choose.",
  options: { checkReload: true },
  page(page, { options, report }) {
    for (const meta of page.all("meta")) {
      if ((getAttr(meta, "http-equiv") ?? "").trim().toLowerCase() !== "refresh" || isInTemplate(page, meta)) continue;
      const refresh = parseRefresh(getAttr(meta, "content") ?? "");
      if (refresh === null || refresh.delay === 0 || refresh.delay > LONGEST_LIMIT) continue;
      const seconds = `${refresh.delay} second${refresh.delay === 1 ? "" : "s"}`;
      if (refresh.url !== null) {
        report({ file: page.file, offset: meta.start, message: `The page moves people to ${shorten(refresh.url)} after ${seconds}, which may be before they have read it. Redirect at once with a delay of 0, or link to the new page` });
      } else if (options.checkReload) {
        report({ file: page.file, offset: meta.start, message: `The page reloads itself every ${seconds}, which interrupts screen readers and loses the reader's place. Let people reload it themselves` });
      }
    }
  },
};

export const a11yRules = [
  imageAlt, placeholderAlt, controlName, labelFor, linkName, buttonName, ariaReference, duplicateId,
  ariaRole, ariaAttribute, hiddenFocusable, positiveTabindex, headingOrder, frameTitle,
  videoCaptions, autoplayAudio, htmlLang, mainLandmark, tableHeaders, thScope, autocomplete,
  metaRefresh,
];
