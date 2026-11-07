// The readable terminal report. Findings group by file. A finding repeated across many files,
// which usually means one layout or stylesheet problem, prints once with a count.

const COLLAPSE_AT = 4;
const LIST_PER_RULE_IN_FILE = 20;
const SUMMARIZE_ABOVE = 20;

const PALETTE = { red: 31, yellow: 33, cyan: 36, dim: 2, bold: 1 };

function painter(enabled) {
  return (name, text) => (enabled ? `\u001b[${PALETTE[name]}m${text}\u001b[0m` : text);
}

function location(finding) {
  if (finding.line === null) return "";
  return finding.column === null ? `${finding.line}` : `${finding.line}:${finding.column}`;
}

function fileLocation(finding) {
  const at = location(finding);
  return at ? `${finding.file}:${at}` : finding.file;
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function collapseRepeats(findings) {
  const groups = new Map();
  for (const finding of findings) {
    const key = `${finding.rule}\0${finding.message}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(finding);
  }
  const repeated = [];
  const single = [];
  for (const group of groups.values()) {
    const files = new Set(group.map((finding) => finding.file));
    if (files.size >= COLLAPSE_AT) repeated.push(group);
    else single.push(...group);
  }
  return { repeated, single };
}

export function formatText(result, { color = false, showAll = false, quiet = false } = {}) {
  const paint = painter(color);
  const severityLabel = (severity) => (severity === "error" ? paint("red", "error  ") : paint("yellow", "warning"));
  const shown = quiet ? result.findings.filter((finding) => finding.severity === "error") : result.findings;
  const { repeated, single } = showAll ? { repeated: [], single: shown } : collapseRepeats(shown);
  const lines = [];

  const byFile = new Map();
  for (const finding of single) {
    if (!byFile.has(finding.file)) byFile.set(finding.file, []);
    byFile.get(finding.file).push(finding);
  }
  const files = [...byFile.keys()].sort();
  for (const file of files) {
    lines.push(paint("bold", file));
    const countInFile = new Map();
    const hiddenInFile = new Map();
    for (const finding of byFile.get(file)) {
      const count = (countInFile.get(finding.rule) ?? 0) + 1;
      countInFile.set(finding.rule, count);
      if (!showAll && count > LIST_PER_RULE_IN_FILE) {
        hiddenInFile.set(finding.rule, (hiddenInFile.get(finding.rule) ?? 0) + 1);
        continue;
      }
      const at = location(finding).padEnd(8);
      lines.push(`  ${paint("dim", at)} ${severityLabel(finding.severity)}  ${finding.message}  ${paint("cyan", finding.rule)}`);
    }
    for (const [rule, hidden] of hiddenInFile) {
      lines.push(paint("dim", `  ... and ${hidden} more from ${rule} in this file (use --all to list them)`));
    }
    lines.push("");
  }

  if (repeated.length > 0) {
    lines.push(paint("bold", "Repeated across files"));
    for (const group of repeated) {
      const files = new Set(group.map((finding) => finding.file));
      const [first] = group;
      lines.push(`  ${severityLabel(first.severity)}  ${first.message}  ${paint("cyan", first.rule)}`);
      const examples = [...group.slice(0, 3)].map(fileLocation).join(", ");
      const more = files.size > 3 ? `, and ${files.size - 3} more` : "";
      lines.push(paint("dim", `           ${plural(files.size, "file")}: ${examples}${more}`));
    }
    lines.push("");
  }

  if (shown.length > SUMMARIZE_ABOVE) {
    lines.push(paint("bold", "By rule"));
    const perRule = new Map();
    for (const finding of shown) perRule.set(finding.rule, (perRule.get(finding.rule) ?? 0) + 1);
    const ranked = [...perRule].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    for (const [rule, count] of ranked) lines.push(`  ${String(count).padStart(5)}  ${rule}`);
    lines.push("");
  }

  const { errors, warnings, suppressed, pages, stylesheets } = result.summary;
  const scope = `${plural(pages, "page")}, ${plural(stylesheets, "stylesheet")}`;
  if (errors === 0 && warnings === 0) {
    const ignoredNote = suppressed > 0 ? ` (${suppressed} ignored by inline comments)` : "";
    lines.push(`No problems found in ${scope}${ignoredNote}.`);
  } else {
    const parts = [paint(errors > 0 ? "red" : "dim", plural(errors, "error")), paint(warnings > 0 ? "yellow" : "dim", plural(warnings, "warning"))];
    if (suppressed > 0) parts.push(`${suppressed} ignored by inline comments`);
    lines.push(`${parts.join(", ")} in ${scope}.`);
  }
  return `${lines.join("\n")}\n`;
}
