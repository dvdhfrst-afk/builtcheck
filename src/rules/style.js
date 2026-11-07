// Rules about CSS and layout classes: pure black and white, banned fonts, and layouts that
// cannot fit on a phone.

import { findPureColors } from "../css/colors.js";
import { familiesFromDeclaration, familiesFromWebFontUrl, normalizeFamily } from "../css/fonts.js";
import { importTarget } from "../css/scanner.js";
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
  },
  stylesheet(source, { options, report }) {
    if (makeMatcher(options.ignoreFiles)(source.file)) return;
    const ignoredProperty = makeMatcher(options.ignoreProperties);
    for (const declaration of source.declarations) {
      const { property } = declaration;
      if (!COLOR_PROPERTY.test(property) && !property.startsWith("--")) continue;
      if (ignoredProperty(property) || isExemptMedia(declaration.atRules)) continue;
      if (options.ignoreSelectors.some((part) => declaration.selector.includes(part))) continue;
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
  stylesheet(source, { options, report }) {
    if (makeMatcher(options.ignoreFiles)(source.file)) return;
    const banned = new Set(options.fonts.map(normalizeFamily));
    for (const declaration of source.declarations) {
      const families = familiesFromDeclaration(declaration.property, declaration.value);
      if (!families || families.length === 0) continue;
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

function baseUtilities(element) {
  return parsedClasses(element).filter((entry) => entry.variants.length === 0);
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

function isClippedOrHidden(element) {
  for (const candidate of [element, ...ancestors(element)]) {
    for (const { utility, variants } of parsedClasses(candidate)) {
      if (variants.length > 0) continue;
      if (utility === "hidden") return true;
      if (candidate !== element && SCROLLING.test(utility)) return true;
    }
  }
  return false;
}

function columnCount(utility) {
  const plain = /^grid-cols-(\d+)$/.exec(utility);
  if (plain) return Number(plain[1]);
  const repeated = /^grid-cols-\[repeat\((\d+),/.exec(utility);
  return repeated ? Number(repeated[1]) : null;
}

function gridOverflow(element, options) {
  const base = baseUtilities(element);
  // A phone-only override such as "max-md:grid-cols-1" means the base value never reaches a phone.
  const hasPhoneOverride = parsedClasses(element).some(
    ({ variants, utility }) => variants.some((variant) => variant.startsWith("max-")) && utility.startsWith("grid-cols-"),
  );
  if (hasPhoneOverride) return null;
  let columns = null;
  let gapName = null;
  let columnGapName = null;
  for (const { utility } of base) {
    const count = columnCount(utility);
    if (count !== null) columns = count;
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

function fixedWidthOverflow(element, options) {
  const base = baseUtilities(element);
  const names = base.map(({ utility }) => utility);
  if (names.includes("absolute") || names.includes("fixed")) return null;
  const isCapped = names.some((name) => /^max-w-(?:full|screen|\[100%\]|\[100vw\]|\[calc)/.test(name));
  for (const { utility } of base) {
    const match = /^(min-w|w)-\[(.+)\]$/.exec(utility);
    if (!match || (match[1] === "w" && isCapped)) continue;
    const width = lengthInPixels(match[2], options);
    if (width !== null && width > options.phoneWidth) {
      return `${utility} is wider than a ${options.phoneWidth}px phone`;
    }
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

function isPhoneMedia(atRules) {
  return atRules.some((rule) => /^@media\b.*(?:max-width\s*:|width\s*<)/i.test(rule));
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
  description: "A layout that cannot fit at phone width: a grid whose gaps alone are wider than the phone, or a fixed width wider than the phone.",
  options: { phoneWidth: 390, spacingUnit: 4, rootFontSize: 16, classPatterns: [] },
  validate: compileClassPatterns,
  page(page, { options, report }) {
    const extra = compileClassPatterns(options);
    for (const element of page.elements) {
      if (!element.attrs.has("class")) continue;
      for (const { regex, message } of extra) {
        const hit = baseUtilities(element).find(({ utility }) => regex.test(utility));
        if (hit) report({ file: page.file, offset: element.start, message: `${hit.utility}: ${message}` });
      }
      const problem = gridOverflow(element, options) ?? fixedWidthOverflow(element, options);
      if (problem && !isClippedOrHidden(element)) {
        report({ file: page.file, offset: element.start, message: problem });
      }
    }
  },
  stylesheet(source, { options, report }) {
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
      const total = (tracks - 1) * gap;
      return total > options.phoneWidth ? { grid, tracks, total } : null;
    };
    for (const declarations of blocks.values()) {
      const problem = overflows(declarations);
      if (!problem || !appliesOnPhone(problem.grid.atRules, options)) continue;
      // Desktop-first CSS replaces the grid in a max-width media query further down.
      const replaced = source.declarations.some(
        (other) =>
          other.property === "grid-template-columns" &&
          other.selector === problem.grid.selector &&
          other.block !== problem.grid.block &&
          isPhoneMedia(other.atRules),
      );
      if (replaced) continue;
      report({
        file: source.file,
        offset: source.baseOffset + problem.grid.offset,
        message: `${problem.tracks} grid columns need ${problem.total}px for gaps alone, wider than a ${options.phoneWidth}px phone`,
      });
    }
  },
};

export const styleRules = [pureColor, bannedFont, phoneOverflow];
