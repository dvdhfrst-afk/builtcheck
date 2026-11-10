// Checkstyle XML, which many CI plugins and code review tools read (Jenkins Warnings, reviewdog,
// SonarQube imports and others). One file element per file, one error element per finding. A
// file the audit left out gets an entry too: an error when it could not be read, and "info" for
// one it left out on purpose, such as a symbolic link out of the site folder.

import { printable } from "./printable.js";
import { XML_DECLARATION, xmlAttribute } from "./xml.js";

const attribute = (text) => xmlAttribute(printable(text));

function errorElement({ line = null, column = null, severity, message, source }) {
  const position = `${line === null ? "" : ` line="${line}"`}${column === null ? "" : ` column="${column}"`}`;
  return `    <error${position} severity="${severity}" message="${attribute(message)}" source="${attribute(source)}"/>`;
}

export function formatCheckstyle(result) {
  const byFile = new Map();
  const add = (file, entry) => {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(entry);
  };
  for (const finding of result.findings) {
    add(finding.file, { line: finding.line, column: finding.column, severity: finding.severity, message: finding.message, source: finding.rule });
  }
  for (const { file, reason, incomplete } of result.skipped ?? []) {
    add(file, { severity: incomplete ? "error" : "info", message: `Not audited: ${reason}`, source: "builtcheck" });
  }

  const lines = [XML_DECLARATION, '<checkstyle version="4.3">'];
  for (const file of [...byFile.keys()].sort()) {
    lines.push(`  <file name="${attribute(file)}">`, ...byFile.get(file).map(errorElement), "  </file>");
  }
  lines.push("</checkstyle>");
  return `${lines.join("\n")}\n`;
}
