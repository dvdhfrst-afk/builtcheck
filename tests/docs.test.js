// Checks that what the documentation says is what happens: its commands run, its sample output is
// the real output, and the promises it makes about the package hold.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allRules } from "../src/rules/index.js";
import { REPO_ROOT } from "./helpers.js";

const BIN = join(REPO_ROOT, "bin", "builtcheck.js");
const read = (...path) => readFileSync(join(REPO_ROOT, ...path), "utf8");
const MARKDOWN = ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "docs/rules.md", "docs/ci.md", "examples/README.md"];

function blocks(text, language) {
  return [...text.matchAll(/^ *```([a-z]*)\n([^]*?)^ *```$/gm)].filter((match) => match[1] === language).map((match) => match[2]);
}

function splitArguments(command) {
  return command.trim().split(/\s+/).slice(2).map((word) => word.replace(/"/g, ""));
}

// A site for "path/to/dist", and a folder outside it for any report a command writes.
function documentedRun(command, folder) {
  const args = splitArguments(command).map((word) => {
    if (word === "path/to/dist") return join(REPO_ROOT, "examples", "before");
    if (word.startsWith("examples/")) return join(REPO_ROOT, ...word.split("/"));
    if (/-report\.html$|^report\.(html|json)$/.test(word)) return join(folder, word);
    return word;
  });
  return spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: folder });
}

for (const file of ["README.md", "examples/README.md"]) {
  test(`every builtcheck command in ${file} runs and exits as a run should`, () => {
    const commands = blocks(read(file), "bash").map((block) => block.trim()).filter((line) => line.startsWith("node bin/builtcheck.js"));
    assert.ok(commands.length >= 3);
    for (const command of commands) {
      const folder = mkdtempSync(join(tmpdir(), "builtcheck-docs-"));
      try {
        const { status, stderr } = documentedRun(command, folder);
        assert.ok(status === 0 || status === 1, `${command} exited ${status}: ${stderr}`);
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    }
  });
}

test("the output shown in the README is the output of that command", () => {
  const readme = read("README.md");
  const { stdout, status } = spawnSync(process.execPath, [BIN, "examples/before", "--no-config", "--quiet"], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(status, 1);
  assert.equal(blocks(readme, "text")[0], stdout);
});

test("the example sites come out as their walkthrough says", () => {
  const walkthrough = read("examples", "README.md");
  const [before, after] = blocks(walkthrough, "text");
  const first = spawnSync(process.execPath, [BIN, "examples/before", "--no-config"], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(first.status, 1);
  assert.ok(first.stdout.endsWith(before), first.stdout.slice(-400));
  const second = spawnSync(process.execPath, [BIN, "examples/after", "--config", "examples/after.config.json"], { encoding: "utf8", cwd: REPO_ROOT });
  assert.equal(second.status, 0);
  assert.equal(second.stdout, after);
  for (const match of walkthrough.matchAll(/`((?:foundation|schema|links|copy|style)\/[a-z-]+)`/g)) {
    assert.ok(first.stdout.includes(match[1]), `the walkthrough names ${match[1]}, which the run does not report`);
  }
});

test("the JSON sample in the CI guide has the fields of a real report", () => {
  const sample = JSON.parse(blocks(read("docs", "ci.md"), "json")[0]);
  const { stdout } = spawnSync(process.execPath, [BIN, "examples/before", "--no-config", "--format", "json"], { encoding: "utf8", cwd: REPO_ROOT });
  const real = JSON.parse(stdout);
  assert.deepEqual(Object.keys(sample), Object.keys(real));
  assert.deepEqual(Object.keys(sample.summary), Object.keys(real.summary));
  assert.deepEqual(Object.keys(sample.findings[0]), Object.keys(real.findings[0]));
  assert.equal(sample.resultVersion, real.resultVersion);
});

test("rule ids named in the README exist", () => {
  const ids = new Set(allRules.map((rule) => rule.id));
  for (const match of read("README.md").matchAll(/\b((?:foundation|schema|links|copy|style)\/[a-z-]+)\b/g)) {
    assert.ok(ids.has(match[1]), match[1]);
  }
});

test("documentation never chains commands, so each can be run in any shell", () => {
  for (const file of MARKDOWN) {
    for (const block of blocks(read(...file.split("/")), "bash")) {
      assert.doesNotMatch(block, /&&|\|\||;\s*$|;\s/m, `${file}: ${block}`);
      assert.equal(block.trim().split("\n").length, 1, `${file}: one command per block: ${block}`);
    }
  }
});

test("relative links in the documentation lead to files", () => {
  for (const file of MARKDOWN) {
    const folder = file.includes("/") ? file.split("/").slice(0, -1) : [];
    for (const match of read(...file.split("/")).matchAll(/\]\((?!https?:)([^)#]+)\)/g)) {
      assert.ok(existsSync(join(REPO_ROOT, ...folder, match[1])), `${file} links to ${match[1]}`);
    }
  }
});

test("the package carries what it needs and can be imported by name", async () => {
  const manifest = JSON.parse(read("package.json"));
  for (const entry of manifest.files) assert.ok(existsSync(join(REPO_ROOT, entry)), entry);
  assert.ok(existsSync(join(REPO_ROOT, manifest.bin.builtcheck)));
  const named = await import("builtcheck");
  assert.equal(typeof named.audit, "function");
  assert.equal(named.version, manifest.version);
  assert.equal(named.audit(join(REPO_ROOT, "examples", "after"), { rules: { "foundation/llms-txt-missing": "off" } }).summary.errors, 0);
});

test("the version in the changelog and the README matches the package", () => {
  const { version } = JSON.parse(read("package.json"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^## ${version.replace(/\./g, "\\.")} `, "m"));
  assert.ok(read("README.md").includes(`builtcheck-${version}.tgz`));
});
