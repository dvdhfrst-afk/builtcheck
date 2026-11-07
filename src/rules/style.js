// Rules about CSS and layout classes: pure black and white, banned fonts, and layouts that
// cannot fit on a phone.

import { findPureColors } from "../css/colors.js";
import { familiesFromDeclaration, familiesFromWebFontUrl, normalizeFamily } from "../css/fonts.js";
import { importTarget } from "../css/scanner.js";
import { isInsideHidden } from "../html/page.js";
import { ancestors, classList, getAttr } from "../html/tree.js";
import { makeMatcher } from "../site/glob.js";

const COLOR_PROPERTY =
  /^(?:color|background(?:-color|-image)?|border(?:-(?:top|right|bottom|left|block|inline)(?:-start|-end)?)?(?:-color)?|outline(?:-color)?|fill|stroke|(?:box|text)-shadow|caret-color|accent-color|column-rule(?:-color)?|text-decoration(?:-color)?|text-emphasis(?:-color)?|flood-color|lighting-color|stop-color|scrollbar-color|-webkit-text-fill-color|-webkit-text-stroke(?:-color)?)$/;

// Print styles and forced color modes are about the medium, not the palette.
function isExemptMedia(atRules) {
  return atRules.some((rule) => /^@media\b.*\b(?:print|forced-colors)\b/i.test(rule));
}

function declarationLabel(declaration) {
  return declaration.selector ? `${declaration.property} of ${declaration.selector}` : declaration.property;
}

const pureColor = {
  id: "style/pure-color",
  severity: "warning",
  description: "Pure black or pure white, in any notation, in CSS or an inline style. Translucent values are not reported.",
  options: {
    ignoreProperties: ["--tw-*"],
    ignoreFiles: [],
    // Widgets that bring their own bundled styles, which the site author does not choose.
    ignoreSelectors: ["maplibregl-", "mapboxgl-", "leaflet-"],
    ignoreUnused: true,
  },
  stylesheet(source, { site, options, report }) {
    if (makeMatcher(options.ignoreFiles)(source.file)) return;
    const ignoredProperty = makeMatcher(options.ignoreProperties);
    for (const declaration of source.declarations) {
      const { property } = declaration;
      if (!COLOR_PROPERTY.test(property) && !property.startsWith("--")) continue;
      if (ignoredProperty(property) || isExemptMedia(declaration.atRules)) continue;
      if (options.ignoreSelectors.some((part) => declaration.selector.includes(part))) continue;
      if (options.ignoreUnused && !site.selectorInUse(declaration.selectorPath)) continue;
      for (const { color, text, index } of findPureColors(declaration.value)) {
        report({
          file: source.file,
          offset: source.baseOffset + declaration.valueOffset + index,
          message: `Pure ${color} (${text}) in ${declarationLabel(declaration)}`,
        });
      }
    }
  },
};

const bannedFont = {
  id: "style/banned-font",
  severity: "warning",
  description: "A configured font is the first choice in a font stack, is declared with @font-face, or is loaded from a web font service.",
  options: {
    fonts: ["Inter", "Roboto", "Helvetica", "Open Sans"],
    checkFallbacks: false,
    ignoreFiles: [],
    ignoreUnused: true,
  },
  page(page, { options, report }) {
    const banned = new Set(options.fonts.map(normalizeFamily));
    for (const link of page.all("link")) {
      const href = getAttr(link, "href");
      if (!href) continue;
      for (const family of familiesFromWebFontUrl(href)) {
        if (banned.has(normalizeFamily(family))) {
          report({ file: page.file, offset: link.start, message: `Banned font "${family}" is loaded from a web font service` });
        }
      }
    }
  },
  stylesheet(source, { site, options, report }) {
    if (makeMatcher(options.ignoreFiles)(source.file)) return;
    const banned = new Set(options.fonts.map(normalizeFamily));
    for (const declaration of source.declarations) {
      const families = familiesFromDeclaration(declaration.property, declaration.value);
      if (!families || families.length === 0) continue;
      if (options.ignoreUnused && !site.selectorInUse(declaration.selectorPath)) continue;
      for (const family of options.checkFallbacks ? families : families.slice(0, 1)) {
        if (banned.has(normalizeFamily(family))) {
          report({
            file: source.file,
            offset: source.baseOffset + declaration.offset,
            message: `Banned font ${family} in ${declarationLabel(declaration)}`,
          });
        }
      }
    }
    for (const statement of source.statements) {
      if (statement.name !== "import") continue;
      for (const family of familiesFromWebFontUrl(importTarget(statement) ?? "")) {
        if (banned.has(normalizeFamily(family))) {
          report({
            file: source.file,
            offset: source.baseOffset + statement.offset,
            message: `Banned font "${family}" is loaded from a web font service`,
          });
        }
      }
    }
  },
};

// ---- Phone overflow

function splitVariants(token) {
  let depth = 0;
  let last = -1;
  for (let i = 0; i < token.length; i += 1) {
    if (token[i] === "[" || token[i] === "(") depth += 1;
    else if (token[i] === "]" || token[i] === ")") depth -= 1;
    else if (token[i] === ":" && depth === 0) last = i;
  }
  const variants = last === -1 ? [] : token.slice(0, last).split(":");
  return { variants, utility: token.slice(last + 1).replace(/^!/, "").replace(/!$/, "") };
}

function parsedClasses(element) {
  return classList(element).map((token) => ({ token, ...splitVariants(token) }));
}

function isMaxVariant(variant) {
  return variant.startsWith("max-");
}

// Utilities that reach a phone, in the order they take effect: no variant, then "max-md:" and
// the like, which apply below a width and override the base.
function phoneUtilities(element) {
  const parsed = parsedClasses(element);
  return [
    ...parsed.filter(({ variants }) => variants.length === 0),
    ...parsed.filter(({ variants }) => variants.length > 0 && variants.every(isMaxVariant)),
  ];
}

// The pixel size of a CSS length in px, rem or em. Null for anything relative to its container.
function lengthInPixels(text, options) {
  const match = /^(-?[\d.]+)(px|rem|em)$/.exec(text.trim());
  if (!match) return null;
  const value = parseFloat(match[1]);
  return match[2] === "px" ? value : value * options.rootFontSize;
}

// The pixel size of a spacing utility value: "10", "0.5", "px" or an arbitrary "[40px]".
function spacingInPixels(value, options) {
  if (value === "px") return 1;
  if (/^[\d.]+$/.test(value)) return parseFloat(value) * options.spacingUnit;
  const arbitrary = /^\[(.+)\]$/.exec(value);
  return arbitrary ? lengthInPixels(arbitrary[1], options) : null;
}

const SCROLLING = /^overflow(?:-x)?-(?:auto|scroll|hidden|clip)$/;

const SCROLLING_VALUE = /^(?:auto|scroll|hidden|clip)$/i;

function scrollsByStylesheet(styles, element) {
  return ["overflow", "overflow-x"].some((property) => {
    const { winner } = styles.cascaded(element, property);
    return winner !== null && SCROLLING_VALUE.test(winner.value.trim().split(/\s+/)[0]);
  });
}

function isClippedOrHidden(page, element) {
  for (const candidate of [element, ...ancestors(element)]) {
    for (const { utility, variants } of parsedClasses(candidate)) {
      if (!variants.every(isMaxVariant)) continue;
      if (utility === "hidden") return true;
      if (candidate !== element && SCROLLING.test(utility)) return true;
    }
    if (candidate !== element && page.styles && scrollsByStylesheet(page.styles, candidate)) return true;
  }
  if (isInsideHidden(element) || page.isInTemplate(element)) return true;
  return page.styles ? page.styles.isSometimesHidden(element) : false;
}

const OUT_OF_FLOW = /^(?:absolute|fixed)$/i;

function columnCount(utility) {
  const plain = /^grid-cols-(\d+)$/.exec(utility);
  if (plain) return Number(plain[1]);
  const repeated = /^grid-cols-\[repeat\((\d+),/.exec(utility);
  return repeated ? Number(repeated[1]) : null;
}

function gridOverflow(element, options) {
  let columns = null;
  let gapName = null;
  let columnGapName = null;
  for (const { utility } of phoneUtilities(element)) {
    const count = columnCount(utility);
    if (count !== null) columns = count;
    else if (utility.startsWith("grid-cols-")) columns = null;
    if (utility.startsWith("gap-x-")) columnGapName = utility;
    else if (utility.startsWith("gap-") && !utility.startsWith("gap-y-")) gapName = utility;
  }
  const name = columnGapName ?? gapName;
  if (columns === null || columns < 2 || name === null) return null;
  const gap = spacingInPixels(name.replace(/^gap-(?:x-)?/, ""), options);
  if (gap === null) return null;
  const total = (columns - 1) * gap;
  if (total <= options.phoneWidth) return null;
  return `grid-cols-${columns} with ${name} needs ${total}px for gaps alone, wider than a ${options.phoneWidth}px phone`;
}

const NAMED_MAX_WIDTHS = { xs: 20, sm: 24, md: 28, lg: 32, xl: 36, "2xl": 42, "3xl": 48, "4xl": 56, "5xl": 64, "6xl": 72, "7xl": 80 };
const SCREEN_WIDTHS = { sm: 640, md: 768, lg: 1024, xl: 1280, "2xl": 1536 };

// How far a max-w utility lets an element grow, in pixels. Zero for anything relative to the
// page or its container, which always fits. Null for no limit this tool can state.
function maxWidthLimit(utility, options) {
  const value = utility.slice("max-w-".length);
  if (/^(?:full|screen|svw|lvw|dvw|min|fit)$/.test(value)) return 0;
  if (value in NAMED_MAX_WIDTHS) return NAMED_MAX_WIDTHS[value] * options.rootFontSize;
  const screen = /^screen-(.+)$/.exec(value);
  if (screen) return SCREEN_WIDTHS[screen[1]] ?? null;
  const arbitrary = /^\[(.+)\]$/.exec(value);
  if (arbitrary) {
    const length = lengthInPixels(arbitrary[1], options);
    if (length !== null) return length;
    return /%|v[wmi]|calc\(|min\(|clamp\(/.test(arbitrary[1]) ? 0 : null;
  }
  return spacingInPixels(value, options);
}

function fixedWidthOverflow(element, options) {
  let width = null;
  let minWidth = null;
  let limit = null;
  const names = [];
  for (const { utility } of phoneUtilities(element)) {
    names.push(utility);
    if (/^w-/.test(utility)) width = utility;
    else if (/^min-w-/.test(utility)) minWidth = utility;
    else if (/^max-w-/.test(utility)) limit = maxWidthLimit(utility, options);
  }
  if (names.includes("absolute") || names.includes("fixed")) return null;
  const sizeOf = (utility) => {
    const match = utility ? /^(?:min-)?w-\[(.+)\]$/.exec(utility) : null;
    return match ? lengthInPixels(match[1], options) : null;
  };
  const tooWide = (size) => size !== null && size > options.phoneWidth;
  if (tooWide(sizeOf(minWidth))) return `${minWidth} is wider than a ${options.phoneWidth}px phone`;
  // A max-width stops a width, though not a min-width.
  if (tooWide(sizeOf(width)) && (limit === null || limit > options.phoneWidth)) {
    return `${width} is wider than a ${options.phoneWidth}px phone`;
  }
  return null;
}

// Whether a CSS block inside these at-rules can apply at phone width.
function appliesOnPhone(atRules, options) {
  for (const rule of atRules) {
    if (!rule.startsWith("@media")) {
      if (rule.startsWith("@container")) return false;
      continue;
    }
    if (/\bprint\b/i.test(rule)) return false;
    const minimum = /(?:min-width\s*:|width\s*>=?)\s*([\d.]+(?:px|rem|em))/i.exec(rule);
    if (minimum) {
      const width = lengthInPixels(minimum[1], options);
      if (width !== null && width > options.phoneWidth) return false;
    }
  }
  return true;
}

function trackCount(value) {
  const repeated = /^repeat\(\s*(\d+)\s*,/i.exec(value.trim());
  if (repeated) return Number(repeated[1]);
  if (/repeat\(|\[/i.test(value)) return null;
  const tracks = value.trim().split(/\s+(?![^(]*\))/);
  return tracks.length >= 2 ? tracks.length : null;
}

function columnGap(declarations, options) {
  let gap = null;
  for (const { property, value } of declarations) {
    if (property === "gap" || property === "grid-gap") {
      const parts = value.trim().split(/\s+/);
      gap = lengthInPixels(parts[parts.length - 1], options);
    } else if (property === "column-gap" || property === "grid-column-gap") {
      gap = lengthInPixels(value, options);
    }
  }
  return gap;
}

// Whether these at-rules apply only below a width that still includes the phone.
function isPhoneMedia(atRules, options) {
  return atRules.some((rule) => {
    const limit = /^@media\b.*(?:max-width\s*:|width\s*<=?)\s*([\d.]+(?:px|rem|em))?/i.exec(rule);
    if (!limit) return false;
    const width = limit[1] ? lengthInPixels(limit[1], options) : null;
    return width === null || width >= options.phoneWidth;
  });
}

function selectorPieces(selector) {
  return selector.split(",").map((piece) => piece.trim().replace(/\s+/g, " "));
}

function sharesSelector(a, b) {
  const pieces = new Set(selectorPieces(a));
  return selectorPieces(b).some((piece) => pieces.has(piece));
}

// What a CSS grid amounts to on a phone, after any max-width media queries in the same source.
// Null when it stops being a grid or cannot be stated.
function gridOnPhone(source, grid, gap, options) {
  let tracks = trackCount(grid.value);
  let currentGap = gap;
  for (const other of source.declarations) {
    if (other.block === grid.block || !isPhoneMedia(other.atRules, options) || !sharesSelector(other.selector, grid.selector)) continue;
    if (other.property === "display" && !/grid/i.test(other.value)) return null;
    if (other.property === "grid-template-columns") tracks = trackCount(other.value);
    const overridden = columnGap([other], options);
    if (overridden !== null) currentGap = overridden;
  }
  return tracks === null || currentGap === null ? null : { tracks, gap: currentGap };
}

const OVERSIZED_PROPERTY = new Set(["width", "min-width"]);
// Rules generated from a class such as "w-[600px]": the class on the element is reported instead.
const WIDTH_UTILITY_SELECTOR = /^\.(?:[\w-]+\\:)*(?:min-)?w-\\\[/;

function isFitting(value, options) {
  const length = lengthInPixels(value, options);
  return length === null || length <= options.phoneWidth;
}

// Whether a declared width really reaches this element on a phone.
function widthReaches(target, declaration, options) {
  const { page, element } = target;
  if (isClippedOrHidden(page, element)) return false;
  const { styles } = page;
  if (!styles) return true;
  const position = styles.cascaded(element, "position").winner;
  if (position && OUT_OF_FLOW.test(position.value.trim())) return false;
  const own = styles.cascaded(element, declaration.property);
  if (own.winner && own.winner.declaration !== declaration && isFitting(own.winner.value, options)) return false;
  if (own.sometimes.some((entry) => isFitting(entry.value, options))) return false;
  if (declaration.property === "width") {
    const cap = styles.cascaded(element, "max-width");
    const fits = (entry) => entry.value.trim().toLowerCase() !== "none" && isFitting(entry.value, options);
    if ((cap.winner && fits(cap.winner)) || cap.sometimes.some(fits)) return false;
  }
  return true;
}

function reportOversizedWidths(source, { site, options, report }) {
  for (const declaration of source.declarations) {
    if (!OVERSIZED_PROPERTY.has(declaration.property)) continue;
    const length = lengthInPixels(declaration.value, options);
    if (length === null || length <= options.phoneWidth || !appliesOnPhone(declaration.atRules, options)) continue;
    if (declaration.atRules.some((rule) => /^@(?:-\w+-)?(?:keyframes|page|font-face)\b/i.test(rule))) continue;
    if (WIDTH_UTILITY_SELECTOR.test(declaration.selector) || declaration.selector.includes("::")) continue;
    let targets;
    if (source.kind === "inline") {
      targets = [{ page: site.page(source.file), element: source.element }];
    } else {
      if (declaration.selectorPath.length === 0) continue;
      targets = site.matchingElements(declaration.selectorPath);
      if (targets.length === 0) {
        if (options.ignoreUnused) continue;
      } else if (!targets.some((target) => widthReaches(target, declaration, options))) {
        continue;
      }
    }
    if (source.kind === "inline" && !widthReaches(targets[0], declaration, options)) continue;
    report({
      file: source.file,
      offset: source.baseOffset + declaration.offset,
      message: `${declaration.property}: ${declaration.value.trim()} is wider than a ${options.phoneWidth}px phone`,
    });
  }
}

function compileClassPatterns(options) {
  return options.classPatterns.map((entry) => {
    const spec = typeof entry === "string" ? { pattern: entry } : entry;
    return { regex: new RegExp(spec.pattern), message: spec.message ?? `Class matches the configured pattern ${spec.pattern}` };
  });
}

const phoneOverflow = {
  id: "style/phone-overflow",
  severity: "error",
  description: "A layout that cannot fit at phone width: a grid whose gaps alone are wider than the phone, or a fixed width or min-width wider than the phone.",
  options: { phoneWidth: 390, spacingUnit: 4, rootFontSize: 16, classPatterns: [], ignoreUnused: true },
  validate: compileClassPatterns,
  page(page, { options, report }) {
    const extra = compileClassPatterns(options);
    for (const element of page.elements) {
      if (!element.attrs.has("class")) continue;
      for (const { regex, message } of extra) {
        const hit = phoneUtilities(element).find(({ utility }) => regex.test(utility));
        if (hit) report({ file: page.file, offset: element.start, message: `${hit.utility}: ${message}` });
      }
      const position = page.styles?.cascaded(element, "position").winner;
      const outOfFlow = position ? OUT_OF_FLOW.test(position.value.trim()) : false;
      const problem = gridOverflow(element, options) ?? (outOfFlow ? null : fixedWidthOverflow(element, options));
      if (problem && !isClippedOrHidden(page, element)) {
        report({ file: page.file, offset: element.start, message: problem });
      }
    }
  },
  stylesheet(source, context) {
    const { site, options, report } = context;
    reportOversizedWidths(source, context);
    const blocks = new Map();
    for (const declaration of source.declarations) {
      if (!blocks.has(declaration.block)) blocks.set(declaration.block, []);
      blocks.get(declaration.block).push(declaration);
    }
    const overflows = (declarations) => {
      const grid = declarations.find(({ property }) => property === "grid-template-columns");
      const tracks = grid ? trackCount(grid.value) : null;
      if (tracks === null) return null;
      const gap = columnGap(declarations, options);
      if (gap === null) return null;
      const onPhone = gridOnPhone(source, grid, gap, options);
      if (onPhone === null) return null;
      const total = (onPhone.tracks - 1) * onPhone.gap;
      return total > options.phoneWidth ? { grid, tracks: onPhone.tracks, total } : null;
    };
    for (const declarations of blocks.values()) {
      const problem = overflows(declarations);
      if (!problem || !appliesOnPhone(problem.grid.atRules, options)) continue;
      if (options.ignoreUnused && !site.selectorInUse(problem.grid.selectorPath)) continue;
      report({
        file: source.file,
        offset: source.baseOffset + problem.grid.offset,
        message: `${problem.tracks} grid columns need ${problem.total}px for gaps alone, wider than a ${options.phoneWidth}px phone`,
      });
    }
  },
};

export const styleRules = [pureColor, bannedFont, phoneOverflow];
