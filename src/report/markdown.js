// GitHub flavored Markdown for a pull request comment: a summary table by rule group, then the
// findings of each rule with file and line, errors first. A long list folds into <details>, and
// the comment stops short of GitHub's limit of 65,536 characters, saying how much it left out.
//
// Text from the audited site is escaped so that it reads as written: it cannot open a table cell,
// a link, an HTML tag or a math block, and an "@name" in it does not notify anyone.

import { printable } from "./printable.js";
import { findingsByRule, plural, reportedRules, rulesByGroup } from "./rules.js";

// Below the limit by enough for a workflow to add a heading or a link to the full report.
export const COMMENT_LIMIT = 60000;
// The note on what was left out, and closing a <details> element, must always fit.
const RESERVE = 400;
const FOLD_ABOVE = 5;
const MESSAGE_CAP = 500;
// A hidden marker, so a workflow can find its earlier comment and replace it.
export const COMMENT_MARKER = "<!-- builtcheck-report -->";

export function escapeMarkdown(value) {
  return printable(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\\`*_[\]|~$]/g, "\\$&")
    // A word joiner after "@" stops a mention without changing how the text looks.
    .replace(/@/g, "@⁠");
}

function capped(text) {
  return text.length > MESSAGE_CAP ? `${text.slice(0, MESSAGE_CAP)}...` : text;
}

function at(finding) {
  if (finding.line === null) return "";
  return finding.column === null ? `${finding.line}` : `${finding.line}:${finding.column}`;
}

function summaryTable(listed, byRule) {
  const rows = ["| Group | Errors | Warnings |", "|---|---:|---:|"];
  let errors = 0;
  let warnings = 0;
  for (const [group, members] of rulesByGroup(listed)) {
    const found = members.flatMap((rule) => byRule.get(rule.id) ?? []);
    if (found.length === 0) continue;
    const groupErrors = found.filter((finding) => finding.severity === "error").length;
    errors += groupErrors;
    warnings += found.length - groupErrors;
    rows.push(`| ${escapeMarkdown(group)} | ${groupErrors} | ${found.length - groupErrors} |`);
  }
  rows.push(`| **Total** | **${errors}** | **${warnings}** |`);
  return rows.join("\n");
}

// Rules with findings, errors first, each kind in rule order.
function orderedSections(listed, byRule) {
  const sections = listed.filter((rule) => byRule.has(rule.id)).map((rule) => ({ rule, findings: byRule.get(rule.id) }));
  const isError = (section) => section.findings.some((finding) => finding.severity === "error");
  return [...sections.filter(isError), ...sections.filter((section) => !isError(section))];
}

function sectionHead(rule, findings) {
  const severity = findings.some((finding) => finding.severity === "error") ? "error" : "warning";
  const files = new Set(findings.map((finding) => finding.file)).size;
  const lines = [`#### \`${rule.id}\`: ${plural(findings.length, severity)}`, ""];
  if (rule.description) lines.push(escapeMarkdown(rule.description), "");
  if (findings.length > FOLD_ABOVE) lines.push("<details>", `<summary>${plural(findings.length, "finding")} in ${plural(files, "file")}</summary>`, "");
  lines.push("| File | Line | Message |", "|---|---:|---|");
  return `${lines.join("\n")}\n`;
}

function skippedSection(skipped) {
  if (skipped.length === 0) return "";
  const items = skipped.map(({ file, reason }) => `- ${escapeMarkdown(file)}: ${escapeMarkdown(capped(reason))}`);
  const list = items.length > FOLD_ABOVE ? ["<details>", `<summary>${plural(items.length, "file")}</summary>`, "", ...items, "", "</details>"] : items;
  return `#### Not covered by this audit\n\n${list.join("\n")}\n\n`;
}

export function formatMarkdown(result, rules = [], limit = COMMENT_LIMIT) {
  const { summary, findings } = result;
  const listed = reportedRules(result, rules);
  const byRule = findingsByRule(findings);
  const scope = `${plural(summary.pages, "page")} and ${plural(summary.stylesheets, "stylesheet")} in ${escapeMarkdown(result.root)}`;
  const ignored = summary.suppressed > 0 ? `, ${summary.suppressed} ignored by inline comments` : "";

  const head = [COMMENT_MARKER];
  if (findings.length === 0) {
    head.push(`### builtcheck: no problems found`, "", `Audited ${scope}${ignored}.`, "");
  } else {
    head.push(`### builtcheck: ${plural(summary.errors, "error")}, ${plural(summary.warnings, "warning")}`, "", `Audited ${scope}${ignored}.`, "", summaryTable(listed, byRule), "");
  }
  if (!result.complete) {
    head.push("> **The audit is incomplete.** Some files could not be read or a rule failed, so these findings are not the whole story.", "");
  }

  let out = `${head.join("\n")}\n`;
  const budget = limit - RESERVE;
  // The list of left out files can be long too, so it only goes in whole, if it fits.
  const skippedText = skippedSection(result.skipped ?? []);
  let skippedLeftOut = 0;
  if (out.length + skippedText.length <= budget) out += skippedText;
  else skippedLeftOut = (result.skipped ?? []).length;

  let shown = 0;
  for (const { rule, findings: found } of orderedSections(listed, byRule)) {
    const close = found.length > FOLD_ABOVE ? "\n</details>\n\n" : "\n";
    const rows = found.map((finding) => `| ${escapeMarkdown(finding.file)} | ${at(finding)} | ${escapeMarkdown(capped(finding.message))} |\n`);
    // A heading goes in only with at least its first finding under it.
    const start = sectionHead(rule, found);
    if (out.length + start.length + rows[0].length + close.length > budget) break;
    out += start;
    for (const row of rows) {
      if (out.length + row.length + close.length > budget) break;
      out += row;
      shown += 1;
    }
    out += close;
  }

  const leftOut = findings.length - shown;
  if (leftOut > 0 || skippedLeftOut > 0) {
    const parts = [];
    if (leftOut > 0) parts.push(`${leftOut} of ${plural(findings.length, "finding")}`);
    if (skippedLeftOut > 0) parts.push(`the list of ${plural(skippedLeftOut, "file")} not covered`);
    out += `**Left out: ${parts.join(", and ")}**, to keep this comment under GitHub's size limit. Write the full report with \`--format html\` or \`--format json\`.\n`;
  }
  return out;
}
