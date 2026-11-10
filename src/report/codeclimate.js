// The Code Climate issue format: a JSON array, which GitLab reads as a code quality report and
// shows on merge requests. GitLab tells new findings from old ones by fingerprint, so a
// fingerprint is made from the rule, file and message and not the line: adding a paragraph above
// a finding must not make it look fixed and found again. The same finding twice in one file is
// told apart by which occurrence it is.

import { createHash } from "node:crypto";
import { TASTE_RULES } from "../rules/taste.js";

const SEVERITY = { error: "major", warning: "minor" };

// Code Climate's own categories. Copy problems are about how a page reads; the rest break or
// mislead something that reads the site.
function category(rule) {
  if (TASTE_RULES.includes(rule)) return "Style";
  return rule.startsWith("copy/") ? "Clarity" : "Bug Risk";
}

function fingerprint(base, occurrence) {
  return createHash("sha256").update(occurrence === 1 ? base : `${base}\0${occurrence}`).digest("hex").slice(0, 32);
}

export function formatCodeclimate(result) {
  const seen = new Map();
  const issues = result.findings.map((finding) => {
    const base = [finding.rule, finding.file, finding.message].join("\0");
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      type: "issue",
      engine_name: "builtcheck",
      check_name: finding.rule,
      description: finding.message,
      categories: [category(finding.rule)],
      severity: SEVERITY[finding.severity] ?? "minor",
      fingerprint: fingerprint(base, occurrence),
      // GitLab needs a line, so a finding about a whole file points at its first.
      location: { path: finding.file, lines: { begin: finding.line ?? 1 } },
    };
  });
  return `${JSON.stringify(issues, null, 2)}\n`;
}
