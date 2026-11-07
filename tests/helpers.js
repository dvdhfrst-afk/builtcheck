// Shared test helpers.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "../src/audit.js";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
export const FIXTURES = join(REPO_ROOT, "tests", "fixtures");

// Writes { "path": contents } into a new temporary folder and passes it to fn.
export function withSite(files, fn) {
  const root = mkdtempSync(join(tmpdir(), "builtcheck-test-"));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, contents);
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Turns off every rule group except the ones under test, so a case reads as one behavior.
export function only(...groups) {
  const rules = { "*": "off" };
  for (const group of groups) rules[group] = "error";
  return { rules };
}

// Audits an in-memory site and returns its findings for one rule group.
export function findingsFor(files, ruleOrGroup, config = {}) {
  return withSite(files, (root) => {
    const rules = { "*": "off", [ruleOrGroup]: "error", ...(config.rules ?? {}) };
    return audit(root, { ...config, rules }).findings;
  });
}

export function page(body, head = "") {
  return `<!doctype html><html lang="en"><head><title>Test</title>${head}</head><body>${body}</body></html>`;
}
