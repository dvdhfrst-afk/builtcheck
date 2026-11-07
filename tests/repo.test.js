// Checks on the repository itself: documentation stays in step with the rules, examples stay
// valid, and project files stay free of literal dash characters.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveConfig } from "../src/engine/config.js";
import { allRules } from "../src/rules/index.js";
import { REPO_ROOT } from "./helpers.js";

function allFiles(folder, found = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = join(folder, entry.name);
    if (entry.isDirectory()) allFiles(path, found);
    else found.push(path);
  }
  return found;
}

test("the rule reference documents every rule with its default severity", () => {
  const docs = readFileSync(join(REPO_ROOT, "docs", "rules.md"), "utf8");
  for (const rule of allRules) {
    assert.ok(docs.includes(`\`${rule.id}\``), `${rule.id} is missing from docs/rules.md`);
    const row = docs.split("\n").find((line) => line.includes(`\`${rule.id}\``) && line.startsWith("|"));
    assert.ok(row && row.includes(rule.severity), `${rule.id} should show severity ${rule.severity}`);
    for (const option of Object.keys(rule.options ?? {})) {
      assert.ok(docs.includes(`\`${option}\``), `option ${option} of ${rule.id} is missing from docs/rules.md`);
    }
  }
});

test("the example config is valid", () => {
  const example = JSON.parse(readFileSync(join(REPO_ROOT, "examples", "builtcheck.config.json"), "utf8"));
  assert.doesNotThrow(() => resolveConfig(example, allRules));
});

test("repository text uses no literal em or en dashes, outside the fixture named for it", () => {
  const offenders = [];
  for (const file of allFiles(REPO_ROOT)) {
    if (file.endsWith("em-dash-literal.html") || /\.(png|jpe?g|woff2)$/.test(file)) continue;
    if (/[\u2013\u2014]/.test(readFileSync(file, "utf8"))) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});

test("the package cannot be published by accident and has no dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.devDependencies, undefined);
});
