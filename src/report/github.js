// Annotations for GitHub Actions, using its workflow command format. Paths are relative to the
// site folder, so annotations show in the log, and attach to a file only if the build output is
// committed. Text from audited files is escaped so it cannot end the command and start another.

import { printable } from "./printable.js";

function escapeData(text) {
  return text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

export function formatGithub(result) {
  const lines = [];
  for (const finding of result.findings) {
    const properties = [`file=${escapeProperty(printable(finding.file))}`];
    if (finding.line !== null) properties.push(`line=${finding.line}`);
    if (finding.column !== null) properties.push(`col=${finding.column}`);
    properties.push(`title=${escapeProperty(finding.rule)}`);
    const command = finding.severity === "error" ? "error" : "warning";
    lines.push(`::${command} ${properties.join(",")}::${escapeData(printable(finding.message))}`);
  }
  for (const { file, reason, incomplete } of (result.skipped ?? [])) {
    lines.push(`::${incomplete ? "error" : "notice"} file=${escapeProperty(printable(file))},title=builtcheck::${escapeData(printable(reason))}`);
  }
  const { errors, warnings, pages } = result.summary;
  lines.push(`builtcheck: ${errors} errors, ${warnings} warnings in ${pages} pages.`);
  return `${lines.join("\n")}\n`;
}
