// Inline ignore comments.
//
//   builtcheck-ignore-file [rules]          the whole file
//   builtcheck-ignore-next-line [rules]     the line after the comment, or the rest of the
//                                           comment's own line if code follows it, as in minified files
//   builtcheck-ignore-next-element [rules]  the next HTML element, CSS rule or group of lines
//
// With no rules named, a directive covers every rule. A rule can be an exact id or a group
// such as "copy/*". Text after " -- " is a free-form reason. An HTML element can also carry
// data-builtcheck-ignore="rules", which survives minifiers that strip comments.

const DIRECTIVE = /^\s*!?\s*builtcheck-ignore-(file|next-line|next-element)(?=\s|$)([^]*)$/;

export function parseRuleList(text) {
  const withoutReason = text.split(/\s--\s|\s--$/)[0];
  const rules = withoutReason.split(/[\s,]+/).filter(Boolean);
  return rules.length === 0 ? null : rules;
}

export function parseDirective(comment) {
  const match = DIRECTIVE.exec(comment);
  if (!match) return null;
  return { kind: match[1], rules: parseRuleList(match[2]) };
}

export function ruleMatches(rules, ruleId) {
  if (rules === null) return true;
  return rules.some((rule) => {
    if (rule === ruleId || rule === "*") return true;
    return rule.endsWith("/*") && ruleId.startsWith(rule.slice(0, -1));
  });
}

export class Suppressions {
  constructor() {
    this.fileRules = [];
    this.lineRules = new Map();
    this.rangeRules = [];
  }

  addFile(rules) {
    this.fileRules.push(rules);
  }

  addLine(line, rules) {
    if (!this.lineRules.has(line)) this.lineRules.set(line, []);
    this.lineRules.get(line).push(rules);
  }

  addRange(start, end, rules) {
    this.rangeRules.push({ start, end, rules });
  }

  // `end` is the offset just after the comment in `text`.
  addNextLine(text, end, lines, rules) {
    const lineBreak = text.indexOf("\n", end);
    const lineEnd = lineBreak === -1 ? text.length : lineBreak;
    if (text.slice(end, lineEnd).trim() !== "") this.addRange(end, lineEnd, rules);
    else this.addLine(lines.locate(end).line + 1, rules);
  }

  matches(ruleId, line, offset) {
    if (this.fileRules.some((rules) => ruleMatches(rules, ruleId))) return true;
    if (line !== null && line !== undefined) {
      const onLine = this.lineRules.get(line);
      if (onLine && onLine.some((rules) => ruleMatches(rules, ruleId))) return true;
    }
    if (offset !== null && offset !== undefined) {
      for (const range of this.rangeRules) {
        if (offset >= range.start && offset < range.end && ruleMatches(range.rules, ruleId)) return true;
      }
    }
    return false;
  }
}

// For plain text formats: robots.txt, llms.txt, sitemap XML, _redirects.
const TEXT_COMMENT = /^\s*(?:#|<!--)\s*(builtcheck-ignore-(?:file|next-line|next-element)[^\n]*?)\s*(?:-->)?\s*$/;

// The lines (0-based) that make up the "element" after a comment: an XML element through its
// closing tag, otherwise everything up to the next blank line.
function nextElementLines(lines, from) {
  const covered = [];
  const first = /^\s*<([\w:.-]+)/.exec(lines[from] ?? "");
  for (let i = from; i < lines.length; i += 1) {
    if (lines[i].trim() === "") break;
    covered.push(i);
    if (first && (lines[i].includes(`</${first[1]}`) || /\/>\s*$/.test(lines[i]))) break;
  }
  return covered;
}

export function suppressionsFromText(text) {
  const suppressions = new Suppressions();
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const match = TEXT_COMMENT.exec(line);
    if (!match) return;
    const directive = parseDirective(match[1]);
    if (!directive) return;
    if (directive.kind === "file") suppressions.addFile(directive.rules);
    else if (directive.kind === "next-line") suppressions.addLine(index + 2, directive.rules);
    else for (const covered of nextElementLines(lines, index + 1)) suppressions.addLine(covered + 1, directive.rules);
  });
  return suppressions;
}
