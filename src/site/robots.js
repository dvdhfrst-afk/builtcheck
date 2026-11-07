// A robots.txt reader following RFC 9309 (the Robots Exclusion Protocol): a crawler obeys the
// groups naming it, or else the "*" groups, and the longest matching path rule decides.

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let group = null;
  let inAgentLines = false;
  text.split("\n").forEach((rawLine, index) => {
    const line = index + 1;
    const content = rawLine.split("#")[0].trim();
    const colon = content.indexOf(":");
    if (colon === -1) return;
    const key = content.slice(0, colon).trim().toLowerCase();
    const value = content.slice(colon + 1).trim();
    if (key === "sitemap") {
      if (value) sitemaps.push({ url: value, line });
      return;
    }
    if (key === "user-agent") {
      if (!inAgentLines || !group) {
        group = { agents: [], rules: [], line };
        groups.push(group);
      }
      group.agents.push({ name: value.toLowerCase(), line });
      inAgentLines = true;
      return;
    }
    inAgentLines = false;
    if (group && (key === "allow" || key === "disallow") && value !== "") {
      group.rules.push({ type: key, path: value, line });
    }
  });
  return { groups, sitemaps };
}

// Does a robots.txt path pattern match? "*" stands for any text and a final "$" ties it to the end.
// Done by hand because a regular expression from a hostile line could be enormous or very slow.
function pathMatches(pattern, path) {
  const anchored = pattern.endsWith("$");
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  if (!path.startsWith(pieces[0])) return false;
  let position = pieces[0].length;
  for (let index = 1; index < pieces.length; index += 1) {
    if (anchored && index === pieces.length - 1) {
      return path.length - pieces[index].length >= position && path.endsWith(pieces[index]);
    }
    const found = path.indexOf(pieces[index], position);
    if (found === -1) return false;
    position = found + pieces[index].length;
  }
  return !anchored || position === path.length;
}

// True when a group names this crawler itself, not through "*".
export function namesCrawler(robots, crawler) {
  const wanted = crawler.toLowerCase();
  return robots.groups.some((group) => group.agents.some((agent) => agent.name === wanted));
}

// Returns { allowed, rule }, where `rule` is the line that decided it (null if none matched).
export function checkAccess(robots, crawler, path) {
  const wanted = crawler.toLowerCase();
  let groups = robots.groups.filter((group) => group.agents.some((agent) => agent.name === wanted));
  if (groups.length === 0) {
    groups = robots.groups.filter((group) => group.agents.some((agent) => agent.name === "*"));
  }
  let best = null;
  for (const group of groups) {
    for (const rule of group.rules) {
      if (!pathMatches(rule.path, path)) continue;
      const better =
        best === null ||
        rule.path.length > best.path.length ||
        (rule.path.length === best.path.length && rule.type === "allow");
      if (better) best = rule;
    }
  }
  return { allowed: best === null || best.type === "allow", rule: best };
}
