// Reads a "_redirects" file, the plain text format several static hosts share. A link to a
// redirected path works once deployed, so it must not count as broken.

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

// A placeholder fills one whole path segment, and only the first "*" is a wildcard. With one
// wildcard at most, a long path cannot send the regular expression into heavy backtracking.
function sourcePattern(source) {
  let usedWildcard = false;
  const segments = safeDecode(source).replace(/\/+$/, "").split("/");
  const last = segments.length - 1;
  const body = segments.map((segment, index) => {
    if (/^:[a-zA-Z_]\w*$/.test(segment)) return "[^/]+";
    if (index === last && segment === "*" && last > 0) {
      usedWildcard = true;
      return null;
    }
    const escaped = segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    return escaped.replace(/\*/g, () => {
      if (usedWildcard) return "\\*";
      usedWildcard = true;
      return ".*";
    });
  });
  const splat = body[last] === null;
  const joined = (splat ? body.slice(0, last) : body).join("/");
  return new RegExp(`^${joined}${splat ? "(?:/.*)?" : "/?"}$`);
}

export function parseRedirects(text) {
  const rules = [];
  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;
    const [source, target] = line.split(/\s+/);
    if (!source || !target || !source.startsWith("/")) return;
    rules.push({ source, target, line: index + 1, pattern: sourcePattern(source) });
  });
  return rules;
}

export function matchRedirect(rules, pathname) {
  return rules.find((rule) => rule.pattern.test(pathname)) ?? null;
}
