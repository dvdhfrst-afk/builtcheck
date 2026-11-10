// The report formats, on real audits of the fixture and example sites, through the registry the
// command line uses and through the command line itself.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { readConfigFile } from "../src/engine/config.js";
import { formatCheckstyle } from "../src/report/checkstyle.js";
import { formatCodeclimate } from "../src/report/codeclimate.js";
import { formatCsv } from "../src/report/csv.js";
import { formatHtml } from "../src/report/html.js";
import { FORMAT_NAMES, FORMATS, formatList } from "../src/report/index.js";
import { formatJunit } from "../src/report/junit.js";
import { COMMENT_LIMIT, COMMENT_MARKER, escapeMarkdown, formatMarkdown } from "../src/report/markdown.js";
import { formatSarif } from "../src/report/sarif.js";
import { xmlAttribute, xmlText } from "../src/report/xml.js";
import { allRules } from "../src/rules/index.js";
import { TASTE_RULES } from "../src/rules/taste.js";
import { FIXTURES, REPO_ROOT, page, withFixtureSite, withSite } from "./helpers.js";

const BIN = join(REPO_ROOT, "bin", "builtcheck.js");
const BEFORE = join(REPO_ROOT, "examples", "before");
const NEW_FORMATS = ["markdown", "junit", "csv", "codeclimate", "checkstyle"];

const auditBefore = () => ({ ...audit(BEFORE, {}), root: "examples/before" });

function auditFixture(name) {
  const configPath = join(FIXTURES, name, "config.json");
  const config = existsSync(configPath) ? readConfigFile(configPath) : {};
  return withFixtureSite(name, (root) => ({ ...audit(root, config), root: name }));
}

// A run where one file disappears between listing and reading, and one rule throws on every page.
function auditWithTrouble() {
  return withSite({ "index.html": page("<p>TODO</p>"), "about.html": page("x"), "gone.html": page("x") }, (root) => {
    const remover = { id: "copy/remover", severity: "error", description: "Removes a file mid-run, for this test.", site() { rmSync(join(root, "gone.html")); } };
    const thrower = { id: "copy/thrower", severity: "warning", description: "Throws, for this test.", page() { throw new Error("odd input"); } };
    const rules = [...allRules, remover, thrower];
    return { result: { ...audit(root, {}, rules), root: "site" }, rules };
  });
}

// Enough of an XML reader to know a CI system's parser will accept the document: one root, tags
// that nest, quoted attributes, known entities, no bare < or &, and no character XML forbids.
function assertWellFormedXml(xml) {
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
  assert.doesNotMatch(xml, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/);
  assert.doesNotMatch(xml, /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
  const body = xml.slice(xml.indexOf("\n") + 1);
  const stack = [];
  let roots = 0;
  const token = /<(\/?)([A-Za-z][\w.-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>|<|&(?!(?:amp|lt|gt|quot|apos|#\d+);)/g;
  for (const match of body.matchAll(token)) {
    assert.ok(match[2] !== undefined, `stray markup at ${match.index}: ${body.slice(match.index, match.index + 40)}`);
    if (stack.length === 0) roots += 1;
    if (match[1]) assert.equal(stack.pop(), match[2]);
    else if (!match[4]) stack.push(match[2]);
  }
  assert.deepEqual(stack, []);
  assert.equal(roots, 1);
}

const unescapeXml = (text) => text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// RFC 4180 read back: quoted fields may hold commas, quotes and line breaks.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else field += character;
  }
  assert.equal(field, "", "the file ends with a line break");
  return rows;
}

function cli(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd: REPO_ROOT });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// ---- The registry and the command line

test("every format is registered with a description and named in the --format help", () => {
  for (const name of NEW_FORMATS) {
    assert.ok(FORMAT_NAMES.includes(name), name);
    assert.ok(FORMATS[name].description.length > 10, name);
    assert.ok(formatList().includes(name), name);
  }
  assert.ok(cli(["--help"]).out.includes("checkstyle"));
});

test("each new format runs from the command line, to stdout and to a file, with the usual exit code", () => {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-formats-"));
  try {
    for (const name of NEW_FORMATS) {
      const printed = cli([BEFORE, "--no-config", "--format", name]);
      assert.equal(printed.code, 1, `${name}: ${printed.err}`);
      const target = join(folder, `report.${name}`);
      const written = cli([BEFORE, "--no-config", "--format", name, "--output", target]);
      assert.equal(written.code, 1, written.err);
      assert.match(written.out, /Report written to/);
      assert.equal(readFileSync(target, "utf8"), printed.out, name);
    }
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("the registry renders each format the way calling it directly does", () => {
  const result = auditBefore();
  const context = { rules: allRules, color: false, showAll: false, quiet: false };
  assert.equal(FORMATS.markdown.render(result, context), formatMarkdown(result, allRules));
  assert.equal(FORMATS.junit.render(result, context), formatJunit(result, allRules));
  assert.equal(FORMATS.csv.render(result, context), formatCsv(result));
  assert.equal(FORMATS.codeclimate.render(result, context), formatCodeclimate(result));
  assert.equal(FORMATS.checkstyle.render(result, context), formatCheckstyle(result));
  assert.equal(FORMATS.html.render(result, context), formatHtml(result, allRules));
});

// ---- Markdown

test("markdown has a summary table by group whose totals are the run's totals", () => {
  const result = auditBefore();
  const markdown = formatMarkdown(result, allRules);
  assert.ok(markdown.startsWith(`${COMMENT_MARKER}\n### builtcheck: ${result.summary.errors} errors, ${result.summary.warnings} warnings`));
  assert.ok(markdown.includes(`| **Total** | **${result.summary.errors}** | **${result.summary.warnings}** |`));
  const groups = [...new Set(result.findings.map((finding) => finding.rule.split("/")[0]))];
  for (const group of groups) assert.match(markdown, new RegExp(`^\\| ${group} \\| \\d+ \\| \\d+ \\|$`, "m"));
});

test("markdown lists every finding under its rule with file and line, errors first", () => {
  const result = auditBefore();
  const markdown = formatMarkdown(result, allRules);
  for (const finding of result.findings) {
    const line = finding.line === null ? "" : `${finding.line}${finding.column === null ? "" : `:${finding.column}`}`;
    assert.ok(markdown.includes(`| ${escapeMarkdown(finding.file)} | ${line} | ${escapeMarkdown(finding.message)} |`), finding.message);
  }
  const headings = [...markdown.matchAll(/^#### `([^`]+)`: \d+ (error|warning)s?$/gm)];
  assert.equal(headings.length, new Set(result.findings.map((finding) => finding.rule)).size);
  const firstWarning = headings.findIndex((heading) => heading[2] === "warning");
  assert.ok(headings.slice(firstWarning).every((heading) => heading[2] === "warning"), "errors come first");
  assert.ok(!markdown.includes("Left out"));
});

test("markdown folds a long list of findings into details, and leaves short ones open", () => {
  const links = Array.from({ length: 7 }, (_, i) => `<a href="/gone-${i}/">x</a>`).join("");
  const result = withSite({ "index.html": page(`${links}<a href="#nowhere">y</a>`) }, (root) => ({ ...audit(root, { rules: { "*": "off", "links/*": "error" } }), root: "site" }));
  const markdown = formatMarkdown(result, allRules);
  assert.match(markdown, /#### `links\/broken-internal`: 7 errors\n\nAn internal link[^\n]*\n\n<details>\n<summary>7 findings in 1 file<\/summary>\n\n\| File/);
  assert.match(markdown, /\| index\.html \| 1:\d+ \| Link \/gone-6\/ [^\n]*\|\n\n<\/details>\n/);
  assert.match(markdown, /#### `links\/missing-anchor`: 1 error\n\n[^\n]*\n\n\| File/);
});

test("markdown stays under GitHub's comment limit and says how much it left out", () => {
  const findings = Array.from({ length: 4000 }, (_, i) => ({
    rule: i % 2 ? "links/broken-internal" : "schema/page-missing",
    severity: i % 2 ? "error" : "warning",
    message: `Link /a-long-path/${"x".repeat(60)}/${i}/ does not resolve to any file in the build`,
    file: `blog/post-${i}/index.html`,
    line: i % 2 ? 10 : null,
    column: i % 2 ? 4 : null,
  }));
  const result = { root: "dist", complete: true, summary: { errors: 2000, warnings: 2000, suppressed: 0, pages: 4000, stylesheets: 0, files: 4000 }, findings, skipped: [] };
  const markdown = formatMarkdown(result, allRules);
  assert.ok(markdown.length <= COMMENT_LIMIT, String(markdown.length));
  assert.ok(COMMENT_LIMIT < 65536);
  const rows = markdown.split("\n").filter((line) => line.startsWith("| blog/")).length;
  const match = /\*\*Left out: (\d+) of 4000 findings\*\*/.exec(markdown);
  assert.ok(match, markdown.slice(-300));
  assert.equal(rows + Number(match[1]), 4000);
  // Errors come first, so it is the warnings that are cut, and every open details is closed.
  assert.equal(markdown.split("<details>").length, markdown.split("</details>").length);
  assert.ok(markdown.indexOf("links/broken-internal") < markdown.indexOf("schema/page-missing") || !markdown.includes("#### `schema/page-missing`"));
});

test("markdown cuts at any limit and never leaves a heading with nothing under it", () => {
  const result = auditBefore();
  for (const limit of [1200, 2500, 4000, 6000]) {
    const markdown = formatMarkdown(result, allRules, limit);
    assert.ok(markdown.length <= limit, `${limit}: ${markdown.length}`);
    assert.doesNotMatch(markdown, /\|---\|---:\|---\|\n\n/);
    assert.match(markdown, /Left out: \d+ of \d+ findings/);
  }
});

test("markdown text from the site cannot make markup, links, math or mentions", () => {
  const hostile = 'Link <script>alert(1)</script> | [x](https://example.com) ![i](https://example.com/i.png) `code` $x^2$ *b* _i_ ~s~ @octocat \\ &amp;';
  const result = {
    root: "dist|`x`",
    complete: true,
    summary: { errors: 1, warnings: 0, suppressed: 0, pages: 1, stylesheets: 0, files: 1 },
    findings: [{ rule: "links/broken-internal", severity: "error", message: hostile, file: "a|b_<c>.html", line: 3, column: 1 }],
    skipped: [],
  };
  const markdown = formatMarkdown(result, allRules);
  assert.ok(!markdown.includes("<script"));
  assert.ok(!markdown.includes("@octocat"));
  assert.ok(markdown.includes("@\u2060octocat"));
  assert.ok(!/[^\\]\[x\]/.test(markdown));
  assert.ok(markdown.includes("\\$x^2\\$"));
  assert.ok(markdown.includes("&amp;amp;"));
  assert.ok(markdown.includes("| a\\|b\\_&lt;c&gt;.html | 3:1 |"));
  // Every cell separator left is one of the table's own: four per row.
  const row = markdown.split("\n").find((line) => line.startsWith("| a"));
  assert.equal(row.replace(/\\\|/g, "").split("|").length - 1, 4);
});

test("markdown on a clean site, an incomplete audit and left out files", () => {
  const clean = withFixtureSite("clean-site", (root) => ({ ...audit(root, {}), root: "clean" }));
  const markdown = formatMarkdown(clean, allRules);
  assert.match(markdown, /### builtcheck: no problems found\n\nAudited \d+ pages and \d+ stylesheets? in clean(, \d+ ignored by inline comments)?\./);
  assert.ok(!markdown.includes("| Group"));
  const { result, rules } = auditWithTrouble();
  const troubled = formatMarkdown(result, rules);
  assert.match(troubled, /The audit is incomplete/);
  assert.match(troubled, /#### Not covered by this audit\n\n(- [^\n]+\n)*- gone\.html: /);
  assert.match(troubled, /rule copy/);
});

// ---- JUnit

test("junit has one suite per rule group and one case per rule, failing where there are findings", () => {
  const result = auditBefore();
  const xml = formatJunit(result, allRules);
  assertWellFormedXml(xml);
  const groups = [...new Set(allRules.map((rule) => rule.id.split("/")[0]))];
  assert.deepEqual([...xml.matchAll(/<testsuite name="([^"]+)"/g)].map((match) => match[1]), groups);
  assert.equal([...xml.matchAll(/<testcase /g)].length, allRules.length);
  const failing = new Set(result.findings.map((finding) => finding.rule));
  assert.match(xml, new RegExp(`<testsuites name="builtcheck" tests="${allRules.length}" failures="${failing.size}" errors="0">`));
  for (const rule of allRules) {
    const testCase = new RegExp(`<testcase name="${rule.id}" classname="builtcheck\\.${rule.id.split("/")[0]}"(/>|>\\n {6}<failure)`).exec(xml);
    assert.ok(testCase, rule.id);
    assert.equal(testCase[1] !== "/>", failing.has(rule.id), rule.id);
  }
});

test("junit failures list each finding with its place, and the type says the severity", () => {
  const result = auditBefore();
  const xml = formatJunit(result, allRules);
  for (const finding of result.findings) {
    const at = finding.line === null ? finding.file : `${finding.file}:${finding.line}${finding.column === null ? "" : `:${finding.column}`}`;
    assert.ok(xml.includes(xmlText(`${at}  ${finding.severity}  ${finding.message}`)), finding.message);
  }
  assert.match(xml, /<testcase name="schema\/recommended-field"[^>]*>\n {6}<failure type="warning" message="5 warnings">/);
  assert.match(xml, /<testcase name="links\/broken-internal"[^>]*>\n {6}<failure type="error" message="2 errors">/);
});

test("junit reports a rule that crashed as an error and lists left out files as system-err", () => {
  const { result, rules } = auditWithTrouble();
  const xml = formatJunit(result, rules);
  assertWellFormedXml(xml);
  assert.match(xml, /<testcase name="copy\/thrower" classname="builtcheck\.copy">\n {6}<error type="rule-failed" message="The rule failed on 2 files">about\.html: rule copy\/thrower failed here: odd input\nindex\.html: rule copy\/thrower failed here: odd input<\/error>/);
  assert.match(xml, /<testsuite name="audit" tests="1" failures="0" errors="1" skipped="0">\n {4}<testcase name="every file was audited" classname="builtcheck\.audit">\n {6}<error type="incomplete" message="3 files could not be fully audited/);
  const systemErr = /<system-err>([^<]*)<\/system-err>/.exec(xml)[1].split("\n");
  assert.deepEqual(systemErr, result.skipped.map(({ file, reason }) => `${file}: ${reason}`));
  assert.ok(systemErr.some((line) => line.startsWith("gone.html: ")));
  assert.match(xml, /<testsuites name="builtcheck" tests="\d+" failures="\d+" errors="2">/);
});

test("junit escapes markup and control characters so the report stays readable XML", () => {
  const message = 'A "quoted" <tag> & \'apostrophe\' \u0001\u0007\u000b\u001b \ud800 \uffff tab\tend\r\nnext \u202e';
  const result = {
    root: "dist",
    complete: false,
    summary: { errors: 1, warnings: 0, suppressed: 0, pages: 1, stylesheets: 0, files: 1 },
    findings: [{ rule: "links/broken-internal", severity: "error", message, file: "a\u0000<b>.html", line: 1, column: 1 }],
    skipped: [{ file: "c\u0008.html", reason: "could not be read: <bad>", incomplete: true }],
  };
  const xml = formatJunit(result, allRules);
  assertWellFormedXml(xml);
  assert.ok(xml.includes("A &quot;quoted&quot; &lt;tag&gt; &amp;") || xml.includes('A "quoted" &lt;tag&gt; &amp;'));
  for (const code of ["\\u0001", "\\u0007", "\\u000b", "\\u001b", "\\u0000", "\\u0008", "\\u202e", "\\ud800", "\\uffff"]) assert.ok(xml.includes(code), code);
  assert.ok(xml.includes("c\\u0008.html: could not be read: &lt;bad&gt;"));
});

test("the XML escapes keep what attributes and text mean", () => {
  assert.equal(xmlText("a & b < c > d\re"), "a &amp; b &lt; c &gt; d&#13;e");
  assert.equal(xmlAttribute('say "hi"\tand \'bye\'\n'), "say &quot;hi&quot;&#9;and &apos;bye&apos;&#10;");
  assert.equal(xmlText("\u0003\ud83d\ude00\udc00"), "\\u0003\ud83d\ude00\\udc00");
  assert.equal(unescapeXml(xmlAttribute('x"<&>\'\ty')), 'x"<&>\'\ty');
});

// ---- CSV

test("csv has a header and one RFC 4180 row per finding that reads back to the finding", () => {
  const result = auditFixture("bad-pages");
  const csv = formatCsv(result);
  assert.ok(!/[^\r]\n/.test(csv), "every line ends with CRLF");
  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ["file", "line", "column", "severity", "rule", "message"]);
  assert.equal(rows.length, result.findings.length + 1);
  result.findings.forEach((finding, i) => {
    const [file, line, column, severity, rule, message] = rows[i + 1];
    assert.equal(file, finding.file);
    assert.equal(line, finding.line === null ? "" : String(finding.line));
    assert.equal(column, finding.column === null ? "" : String(finding.column));
    assert.equal(severity, finding.severity);
    assert.equal(rule, finding.rule);
    const expected = /^[=+\-@]/.test(finding.message) ? `'${finding.message}` : finding.message;
    assert.equal(message.replace(/\\u[0-9a-f]{4}/g, "?"), expected.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, "?"));
  });
});

test("csv cells that a spreadsheet would run as a formula are written as text", () => {
  const starts = ["=HYPERLINK(\"https://example.com\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1", "\r=1", "safe = text"];
  const result = {
    findings: starts.map((message, i) => ({ rule: "copy/placeholder-text", severity: "error", message, file: i === 0 ? "=cmd.html" : "a.html", line: i + 1, column: null })),
  };
  const rows = parseCsv(formatCsv(result)).slice(1);
  assert.equal(rows[0][0], "'=cmd.html");
  assert.equal(rows[0][5], "'=HYPERLINK(\"https://example.com\")");
  assert.equal(rows[1][5], "'+1+1");
  assert.equal(rows[2][5], "'-2+3");
  assert.equal(rows[3][5], "'@SUM(A1)");
  // Tabs and carriage returns are shown as escapes, so they cannot start a formula either.
  assert.equal(rows[4][5], "\\u0009=1");
  assert.equal(rows[5][5], "\\u000d=1");
  assert.equal(rows[6][5], "safe = text");
  for (const row of rows) assert.doesNotMatch(row[5], /^[=+\-@\t\r]/);
});

test("csv quotes commas, quotes and escapes line breaks", () => {
  const result = { findings: [{ rule: "copy/em-dash", severity: "warning", message: 'Say "hi", then\nleave', file: "a,b.html", line: null, column: null }] };
  const csv = formatCsv(result);
  assert.equal(csv.split("\r\n")[1], '"a,b.html",,,warning,copy/em-dash,"Say ""hi"", then\\u000aleave"');
});

// ---- Code Climate

test("codeclimate is an array of GitLab code quality issues with every field it needs", () => {
  const result = auditBefore();
  const issues = JSON.parse(formatCodeclimate(result));
  assert.ok(Array.isArray(issues));
  assert.equal(issues.length, result.findings.length);
  issues.forEach((issue, i) => {
    const finding = result.findings[i];
    assert.equal(issue.type, "issue");
    assert.equal(issue.check_name, finding.rule);
    assert.equal(issue.description, finding.message);
    assert.equal(issue.severity, finding.severity === "error" ? "major" : "minor");
    assert.match(issue.fingerprint, /^[0-9a-f]{32}$/);
    assert.equal(issue.location.path, finding.file);
    assert.equal(issue.location.lines.begin, finding.line ?? 1);
    assert.equal(issue.categories.length, 1);
    if (TASTE_RULES.includes(finding.rule)) assert.deepEqual(issue.categories, ["Style"]);
  });
  assert.equal(new Set(issues.map((issue) => issue.fingerprint)).size, issues.length, "fingerprints are unique");
});

test("codeclimate fingerprints survive lines moving, and change when the finding does", () => {
  const body = '<p>a</p><a href="/gone/">x</a><a href="/gone/">again</a><a href="/other/">y</a>';
  const fingerprints = (html) =>
    withSite({ "index.html": html }, (root) => JSON.parse(formatCodeclimate(audit(root, { rules: { "*": "off", "links/broken-internal": "error" } }))).map((issue) => issue.fingerprint));
  const before = fingerprints(page(body));
  const moved = fingerprints(`\n\n\n${page(`<p>new paragraph</p>\n${body}`)}`);
  assert.equal(before.length, 3);
  assert.deepEqual(moved, before);
  const changed = fingerprints(page(body.replace("/other/", "/elsewhere/")));
  assert.deepEqual(changed.slice(0, 2), before.slice(0, 2));
  assert.notEqual(changed[2], before[2]);
});

// ---- Checkstyle

test("checkstyle has one file element per file and one error per finding, with left out files", () => {
  const result = auditFixture("bad-foundation");
  const xml = formatCheckstyle(result);
  assertWellFormedXml(xml);
  const files = [...xml.matchAll(/<file name="([^"]+)">/g)].map((match) => unescapeXml(match[1]));
  assert.deepEqual(files, [...new Set(result.findings.map((finding) => finding.file))].sort());
  const errors = [...xml.matchAll(/<error (?:line="(\d+)" )?(?:column="(\d+)" )?severity="(error|warning|info)" message="([^"]*)" source="([^"]+)"\/>/g)];
  assert.equal(errors.length, result.findings.length);
  assert.deepEqual(
    errors.map((match) => `${match[5]} ${match[1] ?? "-"} ${match[3]} ${unescapeXml(match[4])}`).sort(),
    result.findings.map((finding) => `${finding.rule} ${finding.line ?? "-"} ${finding.severity} ${finding.message}`).sort(),
  );

  const { result: troubled } = auditWithTrouble();
  const withSkipped = formatCheckstyle(troubled);
  assertWellFormedXml(withSkipped);
  assert.match(withSkipped, /<file name="gone\.html">\n {4}<error severity="error" message="Not audited: [^"]+" source="builtcheck"\/>/);
});

// ---- HTML and SARIF additions

test("the HTML report summarizes by rule group and filters by file as well as severity and rule", () => {
  const result = auditBefore();
  const html = formatHtml(result, allRules);
  assert.match(html, /<table class="groups">/);
  for (const group of new Set(result.findings.map((finding) => finding.rule.split("/")[0]))) {
    const errors = result.findings.filter((finding) => finding.rule.startsWith(`${group}/`) && finding.severity === "error").length;
    assert.match(html, new RegExp(`<button type="button" data-group="${group}">${group}</button></th><td>${errors}</td>`));
    assert.ok(html.includes(`<option value="${group}/*">All ${group} rules</option>`));
  }
  for (const file of new Set(result.findings.map((finding) => finding.file))) assert.ok(html.includes(`<option value="${file}">${file}</option>`), file);
  assert.match(html, /<select id="file">/);
  assert.match(html, /file\.addEventListener\("change", apply\)/);
  // Groups follow the rule order, so foundation comes before style.
  assert.ok(html.indexOf('data-group="foundation"') < html.indexOf('data-group="style"'));
  // Without rules it still works, with groups by name.
  assert.match(formatHtml(result), /<button type="button" data-group="copy">/);
});

test("the HTML report filter script runs and filters by file, group and severity", () => {
  const result = auditBefore();
  const html = formatHtml(result, allRules);
  const script = /<script>([^]*)<\/script>/.exec(html)[1];
  // A small stand in for the page: details with data-file holding items with data-rule.
  const groups = [...html.matchAll(/<details open data-file="([^"]*)"[^>]*>([^]*?)<\/details>/g)].map((match) => ({
    dataset: { file: match[1] },
    hidden: false,
    items: [...match[2].matchAll(/<li class="[^"]*" data-severity="([^"]+)" data-rule="([^"]+)">([^]*?)<\/li>/g)].map((item) => ({ dataset: { severity: item[1], rule: item[2] }, textContent: item[3], hidden: false })),
    querySelectorAll() {
      return this.items;
    },
  }));
  const controls = { severity: { value: "all" }, rule: { value: "all" }, search: { value: "" }, file: { value: "all" } };
  const listeners = [];
  for (const control of Object.values(controls)) control.addEventListener = (_, fn) => listeners.push(fn);
  const buttons = [{ dataset: { group: "links" }, addEventListener: (_, fn) => buttons.push(fn) }];
  const document = {
    getElementById: (id) => controls[id],
    querySelectorAll: (selector) => (selector === "details" ? groups : buttons.slice(0, 1)),
  };
  new Function("document", script)(document);
  const visible = () => groups.flatMap((group) => (group.hidden ? [] : group.items.filter((item) => !item.hidden)));

  controls.file.value = "index.html";
  listeners[0]();
  assert.ok(visible().length > 0);
  assert.ok(groups.filter((group) => !group.hidden).every((group) => group.dataset.file === "index.html"));
  controls.file.value = "all";
  buttons[1]();
  assert.equal(controls.rule.value, "links/*");
  assert.ok(visible().every((item) => item.dataset.rule.startsWith("links/")));
  assert.equal(visible().length, result.findings.filter((finding) => finding.rule.startsWith("links/")).length);
  controls.rule.value = "all";
  controls.severity.value = "warning";
  listeners[0]();
  assert.equal(visible().length, result.summary.warnings);
});

test("SARIF rules carry a full description and a help link to a documentation page that exists", () => {
  const sarif = JSON.parse(formatSarif(auditBefore(), allRules));
  const rules = sarif.runs[0].tool.driver.rules;
  assert.equal(rules.length, allRules.length);
  for (const rule of rules) {
    assert.equal(rule.helpUri, `docs/rules/${rule.id.split("/")[0]}.md`);
    assert.ok(existsSync(join(REPO_ROOT, rule.helpUri)), rule.helpUri);
    assert.ok(readFileSync(join(REPO_ROOT, rule.helpUri), "utf8").includes(`\`${rule.id}\``), rule.id);
    assert.ok(rule.fullDescription.text.startsWith(rule.shortDescription.text), rule.id);
    assert.match(rule.fullDescription.text, /Default severity: (error|warning)\./);
  }
  const font = rules.find((rule) => rule.id === "style/banned-font");
  assert.match(font.fullDescription.text, /Options: [^.]*fonts/);
  assert.match(font.fullDescription.text, /A style preference, not a fault\./);
});

test("the github summary line counts in the singular when there is one", () => {
  const result = { ...audit(BEFORE, {}, allRules, { only: ["links/missing-anchor", "schema/page-missing"] }), root: "examples/before" };
  const last = FORMATS.github.render(result, { rules: allRules }).trim().split("\n").pop();
  assert.equal(last, `builtcheck: 1 error, ${result.summary.warnings === 1 ? "1 warning" : `${result.summary.warnings} warnings`} in 3 pages.`);
});

// ---- Documentation

// The run every sample in docs/formats.md is cut from, as the page says.
const SAMPLE_RULES = ["links/broken-internal", "links/missing-anchor", "copy/placeholder-text", "schema/page-missing"];

test("docs/formats.md describes every format, and each sample is cut from a real run", () => {
  const docs = readFileSync(join(REPO_ROOT, "docs", "formats.md"), "utf8");
  for (const name of FORMAT_NAMES) assert.match(docs, new RegExp(`^## \`${name}\``, "m"), name);
  assert.ok(docs.includes(`--only ${SAMPLE_RULES.join(",")}`), "the page names the run its samples come from");
  const result = { ...audit(BEFORE, {}, allRules, { only: SAMPLE_RULES }), root: "examples/before" };
  const outputs = FORMAT_NAMES.map((name) => FORMATS[name].render(result, { rules: allRules, color: false, showAll: false, quiet: false }).replace(/\r\n/g, "\n"));
  const samples = [...docs.matchAll(/^```(\w+)\n([^]*?)^```$/gm)].filter((match) => !["bash", "yaml", "groovy"].includes(match[1]));
  assert.ok(samples.length >= FORMAT_NAMES.length - 1, String(samples.length));
  for (const [, , sample] of samples) {
    // A line of three dots marks where a sample was shortened.
    for (const line of sample.split("\n").filter((text) => text.trim() !== "" && text.trim() !== "...")) {
      assert.ok(outputs.some((output) => output.includes(line)), `not in any real output: ${line}`);
    }
  }
});

test("an HTML report written by the command line holds the new filters", () => {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-formats-"));
  try {
    const target = join(folder, "report.html");
    writeFileSync(target, "old");
    assert.equal(cli([BEFORE, "--no-config", "--format", "html", "--output", target]).code, 1);
    const html = readFileSync(target, "utf8");
    assert.match(html, /<select id="file">/);
    assert.match(html, /<table class="groups">/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
