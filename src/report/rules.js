// What the report formats say about rules: their group, their documentation page, and the order
// to show them in.

export function ruleGroup(id) {
  return id.split("/")[0];
}

// Relative to the repository and the installed package, which both carry docs/.
export function ruleDocs(id) {
  return `docs/rules/${ruleGroup(id)}.md`;
}

// Every rule a report should describe: the rules of the run, then any rule a finding names that
// is not among them, so a custom rule set passed in code is never dropped.
export function reportedRules(result, rules = []) {
  const listed = [...rules];
  const known = new Set(listed.map((rule) => rule.id));
  for (const finding of result.findings) {
    if (known.has(finding.rule)) continue;
    known.add(finding.rule);
    listed.push({ id: finding.rule, severity: finding.severity, description: "" });
  }
  return listed;
}

// Rules by group, groups in the order their first rule appears.
export function rulesByGroup(rules) {
  const groups = new Map();
  for (const rule of rules) {
    const group = ruleGroup(rule.id);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(rule);
  }
  return groups;
}

export function findingsByRule(findings) {
  const byRule = new Map();
  for (const finding of findings) {
    if (!byRule.has(finding.rule)) byRule.set(finding.rule, []);
    byRule.get(finding.rule).push(finding);
  }
  return byRule;
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// "index.html:14:3", or just the file for a finding about a whole file.
export function findingLocation(finding) {
  if (finding.line === null) return finding.file;
  return `${finding.file}:${finding.line}${finding.column === null ? "" : `:${finding.column}`}`;
}

// The engine records a rule that threw as a skipped entry with this reason.
export function failedRule(entry, rules) {
  return rules.find((rule) => entry.reason.startsWith(`rule ${rule.id} failed here`)) ?? null;
}
