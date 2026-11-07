// Runs the real command line program as a child process.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { resolveConfig, ConfigError } from "../src/engine/config.js";
import { formatHtml } from "../src/report/html.js";
import { formatText } from "../src/report/text.js";
import { allRules } from "../src/rules/index.js";
import { FIXTURES, REPO_ROOT, page, withFixtureSite, withSite } from "./helpers.js";

const BIN = join(REPO_ROOT, "bin", "builtcheck.js");
const CLEAN = join(FIXTURES, "clean-site", "site");
const BROKEN = join(FIXTURES, "bad-foundation", "site");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: options.cwd ?? REPO_ROOT });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function inTempFolder(fn) {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-cli-"));
  try {
    return fn(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("exit code 0 on a clean site", () => {
  withFixtureSite("clean-site", (root) => {
    const { code, out } = run([root]);
    assert.equal(code, 0);
    assert.ok(out.includes("No problems found"));
  });
});

test("exit code 1 when there are errors", () => {
  assert.equal(run([BROKEN]).code, 1);
});

test("warnings alone exit 0, unless a warning limit says otherwise", () => {
  withSite({ "index.html": page("<p>a &mdash; b</p>") }, (root) => {
    inTempFolder((cwd) => {
      writeFileSync(join(cwd, "builtcheck.config.json"), JSON.stringify({ rules: { "*": "off", "copy/*": "warning" } }));
      assert.equal(run([root], { cwd }).code, 0);
      assert.equal(run([root, "--max-warnings", "1"], { cwd }).code, 0);
      assert.equal(run([root, "--max-warnings=0"], { cwd }).code, 1);
    });
  });
});

test("exit code 2 with a clear message when it cannot run", () => {
  const missing = run(["no/such/folder"]);
  assert.equal(missing.code, 2);
  assert.ok(missing.err.includes("Folder not found"));
  assert.equal(run([]).code, 2);
  assert.equal(run([CLEAN, CLEAN]).code, 2);
  assert.equal(run([join(CLEAN, "index.html")]).code, 2);
  assert.equal(run(["--nope", CLEAN]).code, 2);
  assert.equal(run([CLEAN, "--format", "xml"]).code, 2);
  assert.equal(run([CLEAN, "--format"]).code, 2);
  assert.equal(run([CLEAN, "--max-warnings", "lots"]).code, 2);
  assert.equal(run([CLEAN, "--config", "no-such.json"]).code, 2);
  assert.equal(run([CLEAN, "--config", "x.json", "--no-config"]).code, 2);
});

test("a folder with no pages is an error, since it usually means the build did not run", () => {
  withSite({ "a.txt": "x" }, (root) => {
    const { code, err } = run([root]);
    assert.equal(code, 2);
    assert.ok(err.includes("no HTML pages"));
  });
});

test("JSON output is parseable and holds file, line, rule, severity and message", () => {
  const { code, out } = run([BROKEN, "--format", "json"]);
  assert.equal(code, 1);
  const report = JSON.parse(out);
  assert.equal(report.tool, "builtcheck");
  assert.equal(report.summary.errors, 7);
  const finding = report.findings.find((f) => f.rule === "foundation/robots-sitemap");
  assert.deepEqual(Object.keys(finding).sort(), ["column", "file", "line", "message", "rule", "severity"]);
  assert.equal(finding.file, "robots.txt");
  assert.equal(finding.line, 11);
});

test("--output writes the report to a file and still sets the exit code", () => {
  inTempFolder((folder) => {
    const target = join(folder, "report.html");
    const { code, out } = run([BROKEN, "--format", "html", "--output", target]);
    assert.equal(code, 1);
    assert.ok(out.includes(target));
    const html = readFileSync(target, "utf8");
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes("foundation/sitemap-stale-url"));
  });
});

test("an unwritable output path is exit code 2, not a crash", () => {
  const { code, err } = run([CLEAN, "--output", join(CLEAN, "no-such-dir", "x.txt")]);
  assert.equal(code, 2);
  assert.ok(err.length > 0);
});

test("finds builtcheck.config.json in the current folder, and --no-config skips it", () => {
  inTempFolder((cwd) => {
    writeFileSync(join(cwd, "builtcheck.config.json"), JSON.stringify({ rules: { "*": "off" } }));
    assert.equal(run([BROKEN], { cwd }).code, 0);
    assert.equal(run([BROKEN, "--no-config"], { cwd }).code, 1);
  });
});

test("--config, --site-url and --base-path are honored", () => {
  withSite({ "index.html": page('<a href="https://www.example.com/gone">x</a><a href="/docs/gone2">y</a><a href="/docs/">z</a>') }, (root) => {
    inTempFolder((cwd) => {
      const config = join(cwd, "custom.json");
      writeFileSync(config, JSON.stringify({ rules: { "*": "off", "links/broken-internal": "error" } }));
      assert.equal(run([root, "--config", config], { cwd }).code, 1);
      const report = JSON.parse(run([root, "--config", config, "--format", "json", "--site-url", "https://www.example.com", "--base-path", "/docs"], { cwd }).out);
      assert.deepEqual(report.findings.map((f) => f.message.split(" ")[1]), ["/docs/gone2"]);
      assert.equal(report.site.basePath, "/docs");
    });
  });
});

test("a broken config file is exit code 2 and names the problem", () => {
  inTempFolder((cwd) => {
    writeFileSync(join(cwd, "builtcheck.config.json"), "{ not json");
    const { code, err } = run([CLEAN], { cwd });
    assert.equal(code, 2);
    assert.ok(err.includes("not valid JSON"));
  });
});

test("--list-rules, --version, --help and --print-config work with no folder", () => {
  const listed = run(["--list-rules"]);
  assert.equal(listed.code, 0);
  for (const rule of allRules) assert.ok(listed.out.includes(rule.id), rule.id);
  assert.match(run(["--version"]).out, /^\d+\.\d+\.\d+\n$/);
  assert.ok(run(["--help"]).out.includes("Usage"));
  assert.ok(run(["-h"]).out.includes("Usage"));
  const printed = JSON.parse(run(["--print-config"]).out);
  assert.equal(printed.rules["style/banned-font"].fonts.length, 4);
  // What it prints must be accepted back as a config, as is.
  assert.doesNotThrow(() => resolveConfig(printed, allRules));
});

test("output has no color codes when it is not a terminal", () => {
  assert.ok(!run([BROKEN]).out.includes("\u001b["));
});

test("audit leaves the site folder untouched", () => {
  inTempFolder((folder) => {
    assert.equal(run([BROKEN, "--format", "json"], { cwd: folder }).code, 1);
    assert.equal(existsSync(join(folder, "builtcheck-report.html")), false);
  });
});

// ---- config validation

function rejects(user, text) {
  assert.throws(() => resolveConfig(user, allRules), (error) => error instanceof ConfigError && error.message.includes(text), text);
}

test("config mistakes are reported rather than silently ignored", () => {
  rejects([], "must be a JSON object");
  rejects({ rule: {} }, '"rule" is not a config setting');
  rejects({ site: "x" }, '"site" must be an object');
  rejects({ site: { nope: 1 } }, "site.nope is not a setting");
  rejects({ site: { url: "not a url" } }, "not a valid absolute URL");
  rejects({ site: { url: "ftp://example.com" } }, "must be an http or https URL");
  rejects({ site: { url: 5 } }, "site.url must be a string");
  rejects({ site: { externalPaths: "x" } }, "array of strings");
  rejects({ ignore: "x" }, "array of glob strings");
  rejects({ rules: [] }, '"rules" must be an object');
  rejects({ rules: { "copy/em-dashes": "off" } }, 'Did you mean "copy/em-dash"');
  rejects({ rules: { "nope/*": "off" } }, "matches no rule");
  rejects({ rules: { "copy/*": { severity: "off" } } }, "only a severity string");
  rejects({ rules: { "copy/em-dash": "fatal" } }, "severity must be");
  rejects({ rules: { "copy/em-dash": 5 } }, "must be a severity string or an object");
  rejects({ rules: { "copy/em-dash": { nope: 1 } } }, "Options: characters");
  rejects({ rules: { "copy/double-hyphen": { nope: 1 } } }, "It has no options");
  rejects({ rules: { "style/banned-font": { fonts: "Inter" } } }, "must be of type array");
  rejects({ rules: { "style/phone-overflow": { phoneWidth: "390" } } }, "must be of type number");
});

test("a bad regular expression in config is reported as a config problem", () => {
  rejects({ rules: { "copy/placeholder-text": { extraPatterns: ["("] } } }, "regular expression");
  rejects({ rules: { "style/phone-overflow": { classPatterns: ["["] } } }, "regular expression");
});

test("exact rule settings win over group settings in either order", () => {
  const a = resolveConfig({ rules: { "copy/*": "off", "copy/em-dash": "error" } }, allRules);
  const b = resolveConfig({ rules: { "copy/em-dash": "error", "copy/*": "off" } }, allRules);
  for (const config of [a, b]) {
    assert.equal(config.rules["copy/em-dash"].severity, "error");
    assert.equal(config.rules["copy/double-hyphen"].severity, "off");
  }
});

test('"warn" is accepted for "warning"', () => {
  assert.equal(resolveConfig({ rules: { "copy/em-dash": "warn" } }, allRules).rules["copy/em-dash"].severity, "warning");
});

test("the rule set is well formed", () => {
  const ids = allRules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const rule of allRules) {
    assert.match(rule.id, /^(foundation|schema|links|copy|style)\/[a-z-]+$/);
    assert.ok(["error", "warning"].includes(rule.severity), rule.id);
    assert.ok(rule.description.length > 10, rule.id);
    assert.ok(rule.page || rule.stylesheet || rule.site, rule.id);
  }
});

// ---- reports

const SAMPLE = {
  root: "dist",
  summary: { errors: 1, warnings: 1, suppressed: 2, pages: 3, stylesheets: 1, files: 9 },
  findings: [
    { rule: "links/broken-internal", severity: "error", message: 'Link <img src=x onerror="alert(1)"> & more', file: "a<b>.html", line: 4, column: 2 },
    { rule: "copy/em-dash", severity: "warning", message: "Em dash", file: "a<b>.html", line: null, column: null },
  ],
};

test("the HTML report escapes everything taken from the site", () => {
  const html = formatHtml(SAMPLE);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; more"));
  assert.ok(html.includes('data-file="a&lt;b&gt;.html"'));
});

test("the HTML report is self-contained", () => {
  const html = formatHtml(SAMPLE);
  assert.ok(!/<link\b/.test(html));
  assert.ok(!/<script[^>]*\ssrc=/.test(html));
  assert.ok(!/https?:\/\//.test(html));
});

test("a clean HTML report says so and has no filter script", () => {
  const html = formatHtml({ ...SAMPLE, findings: [], summary: { ...SAMPLE.summary, errors: 0, warnings: 0 } });
  assert.ok(html.includes("No problems found"));
  assert.ok(!html.includes("<script"));
});

test("the HTML report passes the style checks it makes on other sites", () => {
  withSite({ "index.html": formatHtml(SAMPLE) }, (root) => {
    const result = audit(root, { rules: { "*": "off", "style/*": "error" } });
    assert.deepEqual(result.findings, []);
  });
});

test("text output collapses a finding repeated across many files", () => {
  const findings = ["a", "b", "c", "d", "e"].map((name) => ({ rule: "schema/page-missing", severity: "warning", message: "No data", file: `${name}.html`, line: null, column: null }));
  const result = { ...SAMPLE, findings, summary: { ...SAMPLE.summary, errors: 0, warnings: 5, suppressed: 0 } };
  const collapsed = formatText(result);
  assert.ok(collapsed.includes("Repeated across files"));
  assert.ok(collapsed.includes("5 files: a.html, b.html, c.html, and 2 more"));
  assert.ok(!collapsed.includes("\ne.html"));
  const all = formatText(result, { showAll: true });
  assert.ok(all.includes("e.html"));
  assert.ok(!all.includes("Repeated across files"));
});

test("text output caps one rule in one file, and --all removes the cap", () => {
  const findings = Array.from({ length: 25 }, (_, line) => ({ rule: "style/pure-color", severity: "warning", message: `m${line}`, file: "a.css", line: line + 1, column: 1 }));
  const result = { ...SAMPLE, findings, summary: { ...SAMPLE.summary, errors: 0, warnings: 25, suppressed: 0 } };
  assert.ok(formatText(result).includes("and 5 more from style/pure-color"));
  assert.ok(formatText(result).includes("By rule"));
  assert.ok(!formatText(result, { showAll: true }).includes("and 5 more"));
});

test("--quiet lists errors but the totals still count warnings", () => {
  const text = formatText(SAMPLE, { quiet: true });
  assert.ok(text.includes("broken-internal"));
  assert.ok(!text.includes("copy/em-dash"));
  assert.ok(text.includes("1 warning"));
});

test("color output is used only when asked", () => {
  assert.ok(formatText(SAMPLE, { color: true }).includes("\u001b["));
  assert.ok(!formatText(SAMPLE).includes("\u001b["));
});
