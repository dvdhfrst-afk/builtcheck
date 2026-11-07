// Compares each fixture site with its expected.json, which was written by hand before the
// rules existed. Any finding that is missing or extra fails, so this measures both misses
// and false alarms.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { FIXTURES, withFixtureSite } from "./helpers.js";

function keyOf({ rule, file, line }) {
  return `${rule} ${file} ${line === null ? "-" : line}`;
}

function counted(keys) {
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

const sites = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

test("the fixture folder holds the expected sites", () => {
  assert.deepEqual(sites.sort(), ["bad-foundation", "bad-pages", "clean-site", "no-foundation", "styled-site"]);
});

for (const name of sites) {
  test(`fixture site ${name} produces exactly the hand-written findings`, () => {
    const folder = join(FIXTURES, name);
    const expected = JSON.parse(readFileSync(join(folder, "expected.json"), "utf8"));
    const configPath = join(folder, "config.json");
    const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
    const result = withFixtureSite(name, (root) => audit(root, config));

    const actual = counted(result.findings.map(keyOf));
    const wanted = counted(expected.findings.map(keyOf));
    const missing = [];
    const extra = [];
    for (const [key, count] of wanted) {
      for (let i = actual.get(key) ?? 0; i < count; i += 1) missing.push(key);
    }
    for (const [key, count] of actual) {
      for (let i = wanted.get(key) ?? 0; i < count; i += 1) {
        const detail = result.findings.find((finding) => keyOf(finding) === key);
        extra.push(`${key}: ${detail.message}`);
      }
    }
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
    assert.equal(result.summary.suppressed, expected.suppressed, "inline ignores applied");
  });
}

test("the clean site reports zero errors and zero warnings", () => {
  const { summary } = withFixtureSite("clean-site", (root) => audit(root));
  assert.equal(summary.errors, 0);
  assert.equal(summary.warnings, 0);
});
