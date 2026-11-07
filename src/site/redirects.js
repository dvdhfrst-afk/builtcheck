// Reads a "_redirects" file, the plain text format several static hosts share. A link to a
// redirected path works once deployed, so it must not count as broken.

function sourcePattern(source) {
  const body = source
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\/\*$/, "(?:/.*)?")
    .replace(/\*/g, ".*")
    .replace(/:[a-zA-Z_]\w*/g, "[^/]+")
    .replace(/\/$/, "");
  return new RegExp(`^${body}/?$`);
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
