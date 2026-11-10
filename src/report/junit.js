// JUnit XML, the test report format GitLab, Jenkins, Azure Pipelines and most other CI systems
// display. Each rule group is a test suite and each rule a test case. A rule with findings fails
// and lists every one of them; a rule that crashed partway is an error, since its silence proves
// nothing. Files the audit left out are listed as system-err of one more test case, which is an
// error when any of them could not be read.

import { printable } from "./printable.js";
import { failedRule, findingLocation, findingsByRule, plural, reportedRules, ruleGroup, rulesByGroup } from "./rules.js";
import { XML_DECLARATION, xmlAttribute, xmlText } from "./xml.js";

const attribute = (text) => xmlAttribute(printable(text));
// One entry per line: each entry is made printable, so a line break inside one cannot pass for
// the start of the next.
const lines = (entries) => xmlText(entries.map(printable).join("\n"));

function counts(findings) {
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.length - errors;
  return [errors ? plural(errors, "error") : "", warnings ? plural(warnings, "warning") : ""].filter(Boolean).join(", ");
}

function testCase(rule, findings, crashes) {
  const open = `    <testcase name="${attribute(rule.id)}" classname="builtcheck.${attribute(ruleGroup(rule.id))}"`;
  if (findings.length === 0 && crashes.length === 0) return { xml: `${open}/>`, failed: false, crashed: false };
  const parts = [`${open}>`];
  if (findings.length > 0) {
    const type = findings.some((finding) => finding.severity === "error") ? "error" : "warning";
    const entryLines = findings.map((finding) => `${findingLocation(finding)}  ${finding.severity}  ${finding.message}`);
    parts.push(`      <failure type="${type}" message="${attribute(counts(findings))}">${lines(entryLines)}</failure>`);
  }
  if (crashes.length > 0) {
    const entryLines = crashes.map(({ file, reason }) => `${file}: ${reason}`);
    parts.push(`      <error type="rule-failed" message="${attribute(`The rule failed on ${plural(crashes.length, "file")}`)}">${lines(entryLines)}</error>`);
  }
  parts.push("    </testcase>");
  return { xml: parts.join("\n"), failed: findings.length > 0, crashed: crashes.length > 0 };
}

function suite(name, cases) {
  const failures = cases.filter((entry) => entry.failed).length;
  const errors = cases.filter((entry) => entry.crashed).length;
  return {
    xml: [`  <testsuite name="${attribute(name)}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="0">`, ...cases.map((entry) => entry.xml), "  </testsuite>"].join("\n"),
    tests: cases.length,
    failures,
    errors,
  };
}

function skippedCase(skipped) {
  const unread = skipped.filter((entry) => entry.incomplete);
  const entryLines = skipped.map(({ file, reason }) => `${file}: ${reason}`);
  const parts = ['    <testcase name="every file was audited" classname="builtcheck.audit">'];
  if (unread.length > 0) {
    parts.push(`      <error type="incomplete" message="${attribute(`${plural(unread.length, "file")} could not be fully audited, so the findings are not the whole story`)}"/>`);
  }
  parts.push(`      <system-err>${lines(entryLines)}</system-err>`, "    </testcase>");
  return { xml: parts.join("\n"), failed: false, crashed: unread.length > 0 };
}

export function formatJunit(result, rules = []) {
  const listed = reportedRules(result, rules);
  const byRule = findingsByRule(result.findings);
  const skipped = result.skipped ?? [];
  const crashes = new Map();
  for (const entry of skipped) {
    const rule = failedRule(entry, listed);
    if (!rule) continue;
    if (!crashes.has(rule.id)) crashes.set(rule.id, []);
    crashes.get(rule.id).push(entry);
  }

  const suites = [];
  for (const [group, members] of rulesByGroup(listed)) {
    suites.push(suite(group, members.map((rule) => testCase(rule, byRule.get(rule.id) ?? [], crashes.get(rule.id) ?? []))));
  }
  if (skipped.length > 0) suites.push(suite("audit", [skippedCase(skipped)]));

  const total = (key) => suites.reduce((sum, entry) => sum + entry[key], 0);
  return `${[
    XML_DECLARATION,
    `<testsuites name="builtcheck" tests="${total("tests")}" failures="${total("failures")}" errors="${total("errors")}">`,
    ...suites.map((entry) => entry.xml),
    "</testsuites>",
  ].join("\n")}\n`;
}
