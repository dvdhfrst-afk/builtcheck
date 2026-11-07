// A simple CSS scanner. It is not a full CSS parser: it finds declarations, the selector
// and at-rules around them, top-level statements such as @import, and comments. It accepts
// nesting, minified input, inline style attribute values and broken input without throwing.
// All offsets are into the text it was given.

function blankRange(chars, start, end) {
  for (let i = start; i < end; i += 1) {
    if (chars[i] !== "\n") chars[i] = " ";
  }
}

// Replaces comments with spaces (keeping every offset valid) and collects them.
function stripComments(text) {
  const comments = [];
  if (!text.includes("/*")) return { clean: text, comments };
  const chars = text.split("");
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
    } else if (ch === "\\") {
      i += 2;
    } else if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      comments.push({ text: text.slice(i + 2, close === -1 ? text.length : close), offset: i, end });
      blankRange(chars, i, end);
      i = end;
    } else {
      i += 1;
    }
  }
  return { clean: chars.join(""), comments };
}

function skipString(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") i += 2;
    else if (ch === quote) return i + 1;
    // An unterminated string ends at the line break, as CSS error recovery does.
    else if (ch === "\n") return i;
    else i += 1;
  }
  return text.length;
}

function skipBalancedBlock(text, open) {
  let depth = 0;
  let i = open;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return text.length;
}

const CUSTOM_PROPERTY_PRELUDE = /^\s*--[\w-]*\s*:/;
const PROPERTY_NAME = /^-{0,2}[a-zA-Z_][\w-]*$/;

export function scanCss(text) {
  const { clean, comments } = stripComments(text);
  const declarations = [];
  const statements = [];
  const stack = [];
  const length = clean.length;
  let blockCounter = 0;
  let start = 0;
  let parens = 0;
  let i = 0;

  const context = () => {
    const atRules = [];
    const selectorPath = [];
    let block = 0;
    for (const entry of stack) {
      block = entry.id;
      if (entry.prelude.startsWith("@")) atRules.push(entry.prelude);
      else selectorPath.push(entry.prelude);
    }
    return { atRules, selector: selectorPath[selectorPath.length - 1] ?? "", selectorPath, block };
  };

  const finishStatement = (from, to) => {
    const piece = clean.slice(from, to);
    const trimmed = piece.trim();
    if (trimmed === "") return;
    const leading = piece.length - piece.trimStart().length;
    const offset = from + leading;
    if (trimmed.startsWith("@")) {
      const match = /^@([\w-]+)\s*/.exec(trimmed);
      statements.push({
        name: match ? match[1].toLowerCase() : "",
        prelude: text.slice(offset + (match ? match[0].length : 1), offset + trimmed.length),
        offset,
      });
      return;
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) return;
    const property = trimmed.slice(0, colon).trim();
    if (!PROPERTY_NAME.test(property)) return;
    let valueStart = offset + colon + 1;
    while (valueStart < to && /\s/.test(clean[valueStart])) valueStart += 1;
    let value = clean.slice(valueStart, offset + trimmed.length);
    let important = false;
    const bang = /\s*!\s*important\s*$/i.exec(value);
    if (bang) {
      important = true;
      value = value.slice(0, bang.index);
    }
    const { atRules, selector, selectorPath, block } = context();
    declarations.push({
      property: property.startsWith("--") ? property : property.toLowerCase(),
      value,
      important,
      offset,
      valueOffset: valueStart,
      selector,
      selectorPath,
      atRules,
      block,
    });
  };

  while (i < length) {
    const ch = clean[i];
    if (ch === '"' || ch === "'") {
      i = skipString(clean, i);
    } else if (ch === "\\") {
      i += 2;
    } else if (ch === "(") {
      if (/url$/i.test(clean.slice(Math.max(0, i - 3), i))) {
        let j = i + 1;
        while (j < length && /\s/.test(clean[j])) j += 1;
        if (clean[j] !== '"' && clean[j] !== "'") {
          // An unquoted url() can hold ";" and "{" (data URIs do), so jump to its end.
          const close = clean.indexOf(")", j);
          i = close === -1 ? length : close + 1;
          continue;
        }
      }
      parens += 1;
      i += 1;
    } else if (ch === ")") {
      if (parens > 0) parens -= 1;
      i += 1;
    } else if (ch === "}") {
      // A brace always ends the block, so one missing ")" cannot swallow the rest of a file.
      parens = 0;
      finishStatement(start, i);
      stack.pop();
      i += 1;
      start = i;
    } else if (parens > 0) {
      i += 1;
    } else if (ch === "{") {
      const prelude = clean.slice(start, i).trim();
      if (CUSTOM_PROPERTY_PRELUDE.test(prelude)) {
        // "--x: { a: b };" is a value, not a block.
        i = skipBalancedBlock(clean, i);
        continue;
      }
      blockCounter += 1;
      stack.push({ prelude: prelude.replace(/\s+/g, " "), id: blockCounter });
      i += 1;
      start = i;
    } else if (ch === ";") {
      finishStatement(start, i);
      i += 1;
      start = i;
    } else {
      i += 1;
    }
  }
  finishStatement(start, length);
  return { declarations, statements, comments };
}

// Each url(...) in a value: { url, index, end }. Written as a scan rather than one regular
// expression, because a file full of unclosed "url(" would make that take minutes.
function urlFunctions(value) {
  const found = [];
  const open = /url\(/gi;
  for (let match = open.exec(value); match; match = open.exec(value)) {
    let i = open.lastIndex;
    while (i < value.length && /\s/.test(value[i])) i += 1;
    const quote = value[i];
    let url;
    let close;
    if (quote === '"' || quote === "'") {
      const endQuote = value.indexOf(quote, i + 1);
      if (endQuote === -1) break;
      url = value.slice(i + 1, endQuote);
      close = value.indexOf(")", endQuote);
    } else {
      close = value.indexOf(")", i);
      url = close === -1 ? "" : value.slice(i, close).trim();
    }
    if (close === -1) break;
    found.push({ url, index: match.index, end: close + 1 });
    open.lastIndex = close + 1;
  }
  return found;
}

// Finds url(...) references in a declaration value or statement prelude.
export function findUrls(value) {
  return urlFunctions(value).map(({ url, index }) => ({ url, index }));
}

// Blanks strings and url() so that value scanners do not read file names as colors.
export function blankStringsAndUrls(value) {
  let result = "";
  let at = 0;
  for (const { index, end } of urlFunctions(value)) {
    result += value.slice(at, index) + " ".repeat(end - index);
    at = end;
  }
  result += value.slice(at);
  return result.replace(/"[^"]*"|'[^']*'/g, (match) => " ".repeat(match.length));
}

// The offset just past the rule or statement that follows `from`.
export function nextRuleEnd(text, from) {
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      i = skipString(text, i);
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
    } else if (ch === ";") {
      return i + 1;
    } else if (ch === "{") {
      return skipBalancedBlock(text, i);
    } else {
      i += 1;
    }
  }
  return text.length;
}

export function importTarget(statement) {
  const prelude = statement.prelude.trim();
  const urls = findUrls(prelude);
  if (urls.length > 0) return urls[0].url;
  const quoted = /^(?:"([^"]*)"|'([^']*)')/.exec(prelude);
  return quoted ? quoted[1] ?? quoted[2] : null;
}
