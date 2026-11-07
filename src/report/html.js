// A single self-contained HTML report: no external files, one small inline script for filters.

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
li { display: grid; grid-template-columns: 4.5em 5em 1fr; gap: 4px 10px; padding: 6px 0; align-items: start; }
li .at { color: var(--muted); font: 13px ui-monospace, Menlo, Consolas, monospace; }
li .severity { font-size: 13px; font-weight: 600; }
li.error .severity { color: var(--error); }
li.warning .severity { color: var(--warning); }
li .message { overflow-wrap: anywhere; }
li .rule { grid-column: 3; color: var(--muted); font: 12px ui-monospace, Menlo, Consolas, monospace; }
.clean { padding: 32px 0; color: var(--ok); font-size: 18px; }
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
  function apply() {
    var text = search.value.toLowerCase();
    document.querySelectorAll("details").forEach(function (group) {
      var visible = 0;
      group.querySelectorAll("li").forEach(function (item) {
        var show = (severity.value === "all" || item.dataset.severity === severity.value)
          && (rule.value === "all" || item.dataset.rule === rule.value)
          && (text === "" || item.textContent.toLowerCase().indexOf(text) !== -1 || group.dataset.file.toLowerCase().indexOf(text) !== -1);
        item.hidden = !show;
        if (show) visible += 1;
      });
      group.hidden = visible === 0;
    });
  }
  severity.addEventListener("change", apply);
  rule.addEventListener("change", apply);
  search.addEventListener("input", apply);
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

export function formatHtml(result) {
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
  const rules = [...new Set(findings.map((finding) => finding.rule))].sort();
  const ruleOptions = rules.map((rule) => `<option value="${escapeHtml(rule)}">${escapeHtml(rule)}</option>`).join("");
  const body =
    findings.length === 0
      ? `<p class="clean">No problems found.</p>`
      : `<div class="filters">
<label>Severity <select id="severity"><option value="all">All</option><option value="error">Errors</option><option value="warning">Warnings</option></select></label>
<label>Rule <select id="rule"><option value="all">All</option>${ruleOptions}</select></label>
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
${body}
</main>
</body>
</html>
`;
}
