// The programmatic entry point: audit a built folder and get the findings back.

import { readFileSync } from "node:fs";
import { resolveConfig } from "./engine/config.js";
import { runRules } from "./engine/engine.js";
import { allRules } from "./rules/index.js";
import { Site } from "./site/site.js";

export const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Bumped only when a field of the result changes or goes away. New fields can appear at any time.
export const RESULT_VERSION = 1;

// `userConfig` has the same shape as a builtcheck.config.json file. `selection` narrows the rules
// that run: { only: ["links/*"], skip: ["copy/em-dash"] }.
export function audit(root, userConfig = {}, rules = allRules, selection = {}) {
  const config = resolveConfig(userConfig, rules, selection);
  const site = new Site(root, config);
  const { findings, suppressed } = runRules(site, config, rules);
  const count = (severity) => findings.filter((finding) => finding.severity === severity).length;
  return {
    tool: "builtcheck",
    version,
    resultVersion: RESULT_VERSION,
    root,
    site: { host: site.ownHost, basePath: site.basePath || "/" },
    // False when a file could not be read or a rule failed: the findings are then not the whole story.
    complete: !site.skipped.some((entry) => entry.incomplete),
    summary: {
      errors: count("error"),
      warnings: count("warning"),
      suppressed,
      pages: site.pages.length,
      stylesheets: site.stylesheets.length,
      files: site.files.size,
    },
    findings,
    skipped: site.skipped,
  };
}
