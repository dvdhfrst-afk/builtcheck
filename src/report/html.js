// A single self-contained HTML report: no external files, one small inline script for filters.

import { findingsByRule, reportedRules, rulesByGroup } from "./rules.js";

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const STYLE = `
:root {
  color-scheme: light dark;
  --paper: oklch(0.985 0.004 250);
  --panel: oklch(0.955 0.006 250);
  --ink: oklch(0.26 0.012 250);
  --muted: oklch(0.48 0.012 250);
  --line: oklch(0.88 0.008 250);
  --error: oklch(0.5 0.17 27);
  --warning: oklch(0.52 0.12 75);
  --ok: oklch(0.48 0.11 150);
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: oklch(0.2 0.01 250);
    --panel: oklch(0.25 0.012 250);
    --ink: oklch(0.92 0.006 250);
    --muted: oklch(0.72 0.01 250);
    --line: oklch(0.35 0.012 250);
    --error: oklch(0.72 0.15 27);
    --warning: oklch(0.8 0.12 85);
    --ok: oklch(0.76 0.12 150);
  }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 64px; background: var(--paper); color: var(--ink); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; }
.scope { color: var(--muted); margin: 0 0 20px; overflow-wrap: anywhere; }
.totals { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.total { background: var(--panel); border-radius: 8px; padding: 10px 14px; min-width: 110px; }
.total b { display: block; font-size: 24px; line-height: 1.2; }
.total.error b { color: var(--error); }
.total.warning b { color: var(--warning); }
.total.ok b { color: var(--ok); }
.filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 20px; }
.filters label { display: inline-flex; gap: 6px; align-items: center; }
.filters select, .filters input[type="search"] { font: inherit; color: inherit; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; max-width: 100%; }
details { border-top: 1px solid var(--line); padding: 10px 0; }
summary { cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }
summary small { font-weight: 400; color: var(--muted); margin-left: 6px; }
ul { list-style: none; margin: 8px 0 0; padding: 0; }
[hidden] { display: none !important; }
li { display: grid; grid-template-columns: 4.5em 5em 1fr; gap: 4px 10px; padding: 6px 0; align-items: start; }
li .at { color: var(--muted); font: 13px ui-monospace, Menlo, Consolas, monospace; }
li .severity { font-size: 13px; font-weight: 600; }
li.error .severity { color: var(--error); }
li.warning .severity { color: var(--warning); }
li .message { overflow-wrap: anywhere; }
li .rule { grid-column: 3; color: var(--muted); font: 12px ui-monospace, Menlo, Consolas, monospace; }
li.note { display: block; }
.clean { padding: 32px 0; color: var(--ok); font-size: 18px; }
.groups { border-collapse: collapse; margin: 0 0 20px; }
.groups th, .groups td { text-align: left; padding: 6px 16px 6px 0; border-bottom: 1px solid var(--line); }
.groups thead th { color: var(--muted); font-weight: 400; font-size: 13px; }
.groups td { font-variant-numeric: tabular-nums; }
.groups button { font: inherit; font-weight: 600; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
@media (max-width: 560px) {
  li { grid-template-columns: 4em 1fr; }
  li .message, li .rule { grid-column: 1 / -1; }
}
`;

const SCRIPT = `
(function () {
  var severity = document.getElementById("severity");
  var rule = document.getElementById("rule");
  var search = document.getElementById("search");
  var file = document.getElementById("file");
  function ruleShown(id) {
    if (rule.value === "all") return true;
    if (rule.value.slice(-2) === "/*") return id.indexOf(rule.value.slice(0, -1)) === 0;
    return id === rule.value;
  }
  function apply() {
    var text = search.value.toLowerCase();
    document.querySelectorAll("details").forEach(function (group) {
      var visible = 0;
      group.querySelectorAll("li").forEach(function (item) {
        var show = (severity.value === "all" || item.dataset.severity === severity.value)
          && ruleShown(item.dataset.rule || "")
          && (file.value === "all" || group.dataset.file === file.value)
          && (text === "" || item.textContent.toLowerCase().indexOf(text) !== -1 || group.dataset.file.toLowerCase().indexOf(text) !== -1);
        item.hidden = !show;
        if (show) visible += 1;
      });
      group.hidden = visible === 0;
    });
  }
  severity.addEventListener("change", apply);
  rule.addEventListener("change", apply);
  file.addEventListener("change", apply);
  search.addEventListener("input", apply);
  document.querySelectorAll("button[data-group]").forEach(function (button) {
    button.addEventListener("click", function () {
      rule.value = button.dataset.group + "/*";
      apply();
    });
  });
})();
`;

function renderFinding(finding) {
  const at = finding.line === null ? "" : `${finding.line}${finding.column === null ? "" : `:${finding.column}`}`;
  return (
    `<li class="${finding.severity}" data-severity="${finding.severity}" data-rule="${escapeHtml(finding.rule)}">` +
    `<span class="at">${at}</span>` +
    `<span class="severity">${finding.severity}</span>` +
    `<span class="message">${escapeHtml(finding.message)}</span>` +
    `<span class="rule">${escapeHtml(finding.rule)}</span>` +
    `</li>`
  );
}

function skippedSection(skipped) {
  if (skipped.length === 0) return "";
  const items = skipped.map(({ file, reason }) => `<li class="note"><span class="message">${escapeHtml(file)}: ${escapeHtml(reason)}</span></li>`).join("");
  return `<details open data-file="" class="skipped"><summary>Not covered by this audit<small>${skipped.length}</small></summary><ul>${items}</ul></details>\n`;
}

// Findings counted by rule group, each group a button that narrows the list to it.
function groupSummary(groups) {
  const rows = [...groups].map(([group, rules]) => {
    const found = rules.flatMap((rule) => rule.findings);
    const errors = found.filter((finding) => finding.severity === "error").length;
    return `<tr><th scope="row"><button type="button" data-group="${escapeHtml(group)}">${escapeHtml(group)}</button></th><td>${errors}</td><td>${found.length - errors}</td><td>${rules.length}</td></tr>`;
  });
  return `<table class="groups"><thead><tr><th scope="col">Group</th><th scope="col">Errors</th><th scope="col">Warnings</th><th scope="col">Rules</th></tr></thead><tbody>${rows.join("")}</tbody></table>\n`;
}

// `rules` sets the order of groups and rules; without it they sort by name.
export function formatHtml(result, rules = []) {
  const { summary, findings } = result;
  const byFile = new Map();
  for (const finding of findings) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }
  const groups = [...byFile.entries()]
    .map(([file, items]) => {
      const errors = items.filter((item) => item.severity === "error").length;
      const warnings = items.length - errors;
      const counts = [errors ? plural(errors, "error") : "", warnings ? plural(warnings, "warning") : ""].filter(Boolean).join(", ");
      return (
        `<details open data-file="${escapeHtml(file)}"><summary>${escapeHtml(file)}<small>${counts}</small></summary>` +
        `<ul>${items.map(renderFinding).join("")}</ul></details>`
      );
    })
    .join("\n");
  const byRule = findingsByRule(findings);
  const ordered = rules.length > 0 ? reportedRules(result, rules) : [...byRule.keys()].sort().map((id) => ({ id }));
  const ruleGroups = new Map();
  for (const [group, members] of rulesByGroup(ordered.filter((rule) => byRule.has(rule.id)))) {
    ruleGroups.set(group, members.map((rule) => ({ id: rule.id, findings: byRule.get(rule.id) })));
  }
  const ruleOptions = [...ruleGroups]
    .map(([group, members]) => {
      const options = members.map(({ id }) => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join("");
      return `<optgroup label="${escapeHtml(group)}"><option value="${escapeHtml(group)}/*">All ${escapeHtml(group)} rules</option>${options}</optgroup>`;
    })
    .join("");
  const fileOptions = [...byFile.keys()].map((file) => `<option value="${escapeHtml(file)}">${escapeHtml(file)}</option>`).join("");
  const body =
    findings.length === 0
      ? `<p class="clean">No problems found.</p>`
      : `${groupSummary(ruleGroups)}<div class="filters">
<label>Severity <select id="severity"><option value="all">All</option><option value="error">Errors</option><option value="warning">Warnings</option></select></label>
<label>Rule <select id="rule"><option value="all">All</option>${ruleOptions}</select></label>
<label>File <select id="file"><option value="all">All</option>${fileOptions}</select></label>
<label>Search <input id="search" type="search"></label>
</div>
${groups}
<script>${SCRIPT}</script>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>builtcheck report</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>builtcheck report</h1>
<p class="scope">${escapeHtml(result.root)}: ${plural(summary.pages, "page")}, ${plural(summary.stylesheets, "stylesheet")}, ${plural(summary.files, "file")}</p>
<div class="totals">
<div class="total ${summary.errors ? "error" : "ok"}"><b>${summary.errors}</b>${summary.errors === 1 ? "error" : "errors"}</div>
<div class="total ${summary.warnings ? "warning" : "ok"}"><b>${summary.warnings}</b>${summary.warnings === 1 ? "warning" : "warnings"}</div>
<div class="total"><b>${summary.suppressed}</b>ignored inline</div>
</div>
${skippedSection(result.skipped ?? [])}${body}
</main>
</body>
</html>
`;
}
