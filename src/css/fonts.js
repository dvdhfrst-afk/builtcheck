// Reads font family names out of CSS values and web font URLs.

function splitStack(value) {
  const families = [];
  let current = "";
  let quote = null;
  let depth = 0;
  for (const ch of value) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "(") {
      depth += 1;
      current += ch;
    } else if (ch === ")") {
      depth = Math.max(0, depth - 1);
      current += ch;
    } else if (ch === "," && depth === 0) {
      families.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  families.push(current);
  return families.map((family) => family.trim()).filter(Boolean);
}

export function normalizeFamily(family) {
  return family
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+(?:vf|var)$/i, "")
    .replace(/(.)\s*variable$/i, "$1")
    .toLowerCase();
}

const FONT_SHORTHAND_SIZE =
  /(?:^|\s)(?:[\d.]+(?:px|r?em|pt|pc|%|vw|vh|vmin|vmax|ex|ch|in|cm|mm|q)|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|var\([^)]*\)|calc\([^)]*\))(?:\s*\/\s*\S+)?\s+([^]+)$/i;

// The ordered family list a declaration sets, or null if it sets none.
export function familiesFromDeclaration(property, value) {
  if (property === "font-family" || /^--[\w-]*(font|typeface)/i.test(property)) {
    return splitStack(value);
  }
  if (property === "font") {
    const match = FONT_SHORTHAND_SIZE.exec(value);
    return match ? splitStack(match[1]) : null;
  }
  return null;
}

const WEB_FONT_HOST = /^(?:https?:)?\/\/(?:fonts\.googleapis\.com|fonts\.bunny\.net)\//i;

// Family names requested by a Google Fonts style stylesheet URL.
export function familiesFromWebFontUrl(url) {
  if (!WEB_FONT_HOST.test(url)) return [];
  const query = url.split("?")[1];
  if (!query) return [];
  const families = [];
  for (const part of query.split(/&(?:amp;)?/)) {
    if (!part.startsWith("family=")) continue;
    let value = part.slice("family=".length);
    try {
      value = decodeURIComponent(value.replace(/\+/g, " "));
    } catch {
      value = value.replace(/\+/g, " ");
    }
    // The older API lists several families separated by "|", each with ":weights".
    for (const family of value.split("|")) families.push(family.split(":")[0]);
  }
  return families.filter(Boolean);
}
