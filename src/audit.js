// The programmatic entry point: audit a built folder and get the findings back.

import { readFileSync } from "node:fs";
import { resolveConfig } from "./engine/config.js";
import { runRules } from "./engine/engine.js";
import { allRules } from "./rules/index.js";
import { Site } from "./site/site.js";

export const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// `userConfig` has the same shape as a builtcheck.config.json file.
export function audit(root, userConfig = {}, rules = allRules) {
  const config = resolveConfig(userConfig, rules);
  const site = new Site(root, config);
  const { findings, suppressed } = runRules(site, config, rules);
  const count = (severity) => findings.filter((finding) => finding.severity === severity).length;
  return {
    tool: "builtcheck",
    version,
    root,
    site: { host: site.ownHost, basePath: site.basePath || "/" },
    summary: {
      errors: count("error"),
      warnings: count("warning"),
      suppressed,
      pages: site.pages.length,
      stylesheets: site.stylesheets.length,
      files: site.files.size,
    },
    findings,
  };
}
