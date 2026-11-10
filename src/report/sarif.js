// SARIF (Static Analysis Results Interchange Format) 2.1.0, the format code scanning services read.

import { version } from "../audit.js";
import { TASTE_RULES } from "../rules/taste.js";
import { ruleDocs } from "./rules.js";

// What a code scanning service shows when someone opens the rule: what it reports, how serious
// it is by default, and what can be changed about it. helpUri is relative to the repository and
// the package, which both carry docs/, since an offline tool has no web address of its own.
function fullDescription(rule) {
  const parts = [rule.description, `Default severity: ${rule.severity}.`];
  const options = Object.keys(rule.options ?? {});
  if (options.length > 0) parts.push(`Options: ${options.join(", ")}.`);
  if (TASTE_RULES.includes(rule.id)) parts.push("A style preference, not a fault.");
  parts.push(`Documented in ${ruleDocs(rule.id)}.`);
  return parts.join(" ");
}

function fileUri(file) {
  return file.split("/").map(encodeURIComponent).join("/");
}

export function formatSarif(result, rules) {
  const results = result.findings.map((finding) => {
    const physicalLocation = { artifactLocation: { uri: fileUri(finding.file), uriBaseId: "SITEROOT" } };
    if (finding.line !== null) {
      physicalLocation.region = { startLine: finding.line };
      if (finding.column !== null) physicalLocation.region.startColumn = finding.column;
    }
    return {
      ruleId: finding.rule,
      level: finding.severity === "error" ? "error" : "warning",
      message: { text: finding.message },
      locations: [{ physicalLocation }],
    };
  });
  const notifications = (result.skipped ?? []).map(({ file, reason, incomplete }) => ({
    level: incomplete ? "error" : "note",
    message: { text: `${file}: ${reason}` },
  }));
  const report = {
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "builtcheck",
            version,
            rules: rules.map((rule) => ({
              id: rule.id,
              shortDescription: { text: rule.description },
              fullDescription: { text: fullDescription(rule) },
              helpUri: ruleDocs(rule.id),
              defaultConfiguration: { level: rule.severity === "error" ? "error" : "warning" },
            })),
          },
        },
        invocations: [{ executionSuccessful: result.complete, toolExecutionNotifications: notifications }],
        results,
      },
    ],
  };
  return `${JSON.stringify(report, null, 2)}\n`;
}
