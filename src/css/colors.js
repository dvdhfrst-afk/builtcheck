// Finds pure black and pure white in a CSS value, in every notation that means the same
// thing. A color with any transparency is not reported: rgba(0,0,0,.3) is a shadow tint.

import { blankStringsAndUrls } from "./scanner.js";

const HEX = /#([0-9a-fA-F]{3,8})(?![\w-])/g;
const KEYWORD = /(?<![-\w#.])(black|white)(?![-\w])/gi;
const FUNCTION = /(?<![-\w])(rgba?|hsla?|hwb|oklch|oklab|lch|lab|color)\(((?:[^()]|\([^()]*\))*)\)/gi;

// Utility frameworks compile "bg-white" to rgb(255 255 255 / var(--tw-bg-opacity, 1)), which is
// opaque unless another class sets that variable. Any other var() can hold anything, except
// that its fallback says what the author expects.
function resolveVariables(argumentText) {
  return argumentText
    .replace(/var\(\s*--tw-[\w-]*opacity\s*(?:,[^()]*)?\)/gi, "1")
    .replace(/var\(\s*--[\w-]+\s*,\s*([^()]*)\)/gi, "$1");
}

// color-mix(in srgb, #000 50%, transparent) is not black. Blanks each call, keeping offsets.
function blankColorMix(value) {
  let result = value;
  const open = /color-mix\(/gi;
  for (let match = open.exec(value); match; match = open.exec(value)) {
    let depth = 1;
    let i = open.lastIndex;
    while (i < value.length && depth > 0) {
      if (value[i] === "(") depth += 1;
      else if (value[i] === ")") depth -= 1;
      i += 1;
    }
    result = result.slice(0, match.index) + " ".repeat(i - match.index) + result.slice(i);
    open.lastIndex = i;
  }
  return result;
}

function classifyHex(digits) {
  const hex = digits.toLowerCase();
  let rgb;
  let alpha = "ff";
  if (hex.length === 3 || hex.length === 4) {
    rgb = hex.slice(0, 3);
    if (rgb[0] !== rgb[1] || rgb[1] !== rgb[2]) return null;
    if (hex.length === 4) alpha = hex[3] + hex[3];
    rgb = rgb.repeat(2);
  } else if (hex.length === 6 || hex.length === 8) {
    rgb = hex.slice(0, 6);
    if (hex.length === 8) alpha = hex.slice(6);
  } else {
    return null;
  }
  if (alpha !== "ff") return null;
  if (rgb === "000000") return "black";
  if (rgb === "ffffff") return "white";
  return null;
}

function number(text) {
  if (text === undefined) return NaN;
  return text.endsWith("%") ? parseFloat(text) / 100 : parseFloat(text);
}

function isOpaque(alpha) {
  return alpha === undefined || number(alpha) === 1;
}

// Lightness is a number from 0 to `scale`, or a percentage.
function lightness(text, scale) {
  if (text === undefined) return NaN;
  return text.endsWith("%") ? parseFloat(text) / 100 : parseFloat(text) / scale;
}

function classifyFunction(name, argumentText) {
  const resolved = resolveVariables(argumentText);
  if (resolved.includes("(")) return null;
  const parts = resolved.trim().split(/[\s,/]+/).filter(Boolean);
  const kind = name.toLowerCase();
  if (kind === "rgb" || kind === "rgba") {
    if (!isOpaque(parts[3])) return null;
    const channels = parts.slice(0, 3).map((part) => (part.endsWith("%") ? parseFloat(part) / 100 : parseFloat(part) / 255));
    if (channels.length !== 3) return null;
    if (channels.every((value) => value === 0)) return "black";
    if (channels.every((value) => value === 1)) return "white";
    return null;
  }
  if (kind === "hsl" || kind === "hsla") {
    if (!isOpaque(parts[3])) return null;
    const value = lightness(parts[2], 100);
    if (value === 0) return "black";
    if (value === 1) return "white";
    return null;
  }
  if (kind === "hwb") {
    if (!isOpaque(parts[3])) return null;
    const whiteness = lightness(parts[1], 100);
    const blackness = lightness(parts[2], 100);
    if (whiteness === 1 && blackness === 0) return "white";
    if (whiteness === 0 && blackness === 1) return "black";
    return null;
  }
  if (kind === "oklch" || kind === "lch") {
    if (!isOpaque(parts[3]) || parseFloat(parts[1]) !== 0) return null;
    const value = lightness(parts[0], kind === "oklch" ? 1 : 100);
    if (value === 0) return "black";
    if (value === 1) return "white";
    return null;
  }
  if (kind === "oklab" || kind === "lab") {
    if (!isOpaque(parts[3]) || parseFloat(parts[1]) !== 0 || parseFloat(parts[2]) !== 0) return null;
    const value = lightness(parts[0], kind === "oklab" ? 1 : 100);
    if (value === 0) return "black";
    if (value === 1) return "white";
    return null;
  }
  if (kind === "color") {
    if (!isOpaque(parts[4]) || parts.length < 4) return null;
    const channels = parts.slice(1, 4).map(number);
    if (channels.every((value) => value === 0)) return "black";
    if (channels.every((value) => value === 1)) return "white";
    return null;
  }
  return null;
}

// Returns [{ color: "black" | "white", text, index }] in order of appearance.
export function findPureColors(value) {
  const scanned = blankColorMix(blankStringsAndUrls(value));
  const found = [];
  for (const match of scanned.matchAll(HEX)) {
    const color = classifyHex(match[1]);
    if (color) found.push({ color, text: match[0], index: match.index });
  }
  for (const match of scanned.matchAll(FUNCTION)) {
    const color = classifyFunction(match[1], match[2]);
    if (color) found.push({ color, text: match[0], index: match.index });
  }
  for (const match of scanned.matchAll(KEYWORD)) {
    found.push({ color: match[1].toLowerCase(), text: match[0], index: match.index });
  }
  return found.sort((a, b) => a.index - b.index);
}
