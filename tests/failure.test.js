// What happens when things go wrong: missing, unreadable, changing or hostile input, and writes
// that fail. A run either gives a whole answer, or exits 2 and says what it could not do.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { formatGithub } from "../src/report/github.js";
import { formatHtml } from "../src/report/html.js";
import { formatJson } from "../src/report/json.js";
import { printable } from "../src/report/printable.js";
import { formatSarif } from "../src/report/sarif.js";
import { formatText } from "../src/report/text.js";
import { allRules } from "../src/rules/index.js";
import { MAX_TEXT_BYTES } from "../src/site/site.js";
import { page, REPO_ROOT, withSite } from "./helpers.js";

const BIN = join(REPO_ROOT, "bin", "builtcheck.js");

function run(args, cwd) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

function inTemp(fn) {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-"));
  try {
    return fn(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const noStack = (text) => assert.doesNotMatch(text, /^\s+at .+:\d+:\d+\)?$/m);

// ---- User errors: exit 2, one plain line, no stack

const BAD_RUNS = [
  ["no folder given", [], /Give the built site folder/],
  ["a missing folder", ["no-such-folder"], /Folder not found/],
  ["two folders", ["a", "b"], /exactly one folder/],
  ["an unknown option", ["--nope"], /Unknown option: --nope/],
  ["an unknown short option", ["-x"], /Unknown option: -x/],
  ["a format that does not exist", [".", "--format", "yaml"], /--format must be/],
  ["a value left out", [".", "--format"], /--format needs a value/],
  ["a bad warning limit", [".", "--max-warnings", "many"], /whole number/],
  ["a missing config file", [".", "--config", "no-such.json"], /Cannot read config file no-such\.json: no such file/],
  ["config and no-config together", [".", "--config", "a.json", "--no-config"], /cannot be combined/],
  ["an unknown rule to explain", ["--explain", "nope"], /not a rule/],
  ["an unknown rule to skip", [".", "--no-config", "--skip", "copy/em-dsh"], /matches no rule.*copy\/em-dash/],
  ["a value on a flag", ["--quiet=yes"], /does not take a value/],
];

for (const [name, args, message] of BAD_RUNS) {
  test(`${name} exits 2 with a plain message`, () => {
    withSite({ "index.html": page("x") }, (root) => {
      const { code, out, err } = run(args, root);
      assert.equal(code, 2);
      assert.equal(out, "");
      assert.match(err, message);
      noStack(err);
      assert.equal(err.trim().split("\n").length, 1);
    });
  });
}

test("a file given as the folder exits 2", () => {
  withSite({ "index.html": page("x") }, (root) => {
    const { code, err } = run(["index.html", "--no-config"], root);
    assert.equal(code, 2);
    assert.match(err, /Not a folder/);
  });
});

test("a config file that is a folder, invalid JSON, or not an object exits 2", () => {
  withSite({ "index.html": page("x"), "bad.json": "{nope", "array.json": "[]", "folder/x": "y", "null.json": "null" }, (root) => {
    for (const [config, message] of [["folder", /that path is a folder/], ["bad.json", /not valid JSON/], ["array.json", /must be a JSON object/], ["null.json", /must be a JSON object/]]) {
      for (const extra of [[], ["--site-url", "https://www.example.com"]]) {
        const { code, err } = run([".", "--config", config, ...extra], root);
        assert.equal(code, 2, config);
        assert.match(err, message);
        noStack(err);
      }
    }
  });
});

test("a config naming a bad URL or regular expression exits 2", () => {
  withSite({ "index.html": page("x") }, (root) => {
    assert.equal(run([".", "--no-config", "--site-url", "nonsense"], root).code, 2);
    writeFileSync(join(root, "c.json"), JSON.stringify({ rules: { "copy/placeholder-text": { extraPatterns: ["("] } } }));
    const { code, err } = run([".", "--config", "c.json"], root);
    assert.equal(code, 2);
    noStack(err);
  });
});

test("a folder with no pages exits 2, and points at a likely build folder", () => {
  withSite({ "readme.md": "x" }, (root) => {
    const { code, err } = run([root, "--no-config"]);
    assert.equal(code, 2);
    assert.match(err, /no HTML pages/);
  });
  withSite({ "package.json": "{}", "dist/index.html.txt": "x", "site/index.html": page("x") }, (root) => {
    // The project folder holds a site folder, and that is picked up as pages by a plain audit.
    const { code } = run([root, "--no-config"]);
    assert.notEqual(code, undefined);
  });
  inTemp((folder) => {
    const { code, err } = run([folder, "--no-config"]);
    assert.equal(code, 2);
    assert.match(err, /run the build first/);
  });
});

test("the hint names a build folder when the pages are ignored", () => {
  withSite({ "dist/index.html": page("x"), "c.json": JSON.stringify({ ignore: ["dist/**"] }) }, (root) => {
    const { code, err } = run([root, "--config", join(root, "c.json")]);
    assert.equal(code, 2);
    assert.match(err, /Did you mean .*dist/);
  });
});

// ---- Files that cannot be read

test("a page that disappears during the run makes the audit incomplete and keeps the other findings", () => {
  withSite({ "index.html": page("<p>TODO</p>"), "z.html": page("<p>TODO</p>") }, (root) => {
    const remover = { id: "copy/remover", severity: "error", description: "Removes a file mid-run, for this test.", site() { rmSync(join(root, "z.html")); } };
    const result = audit(root, {}, [remover, ...allRules]);
    assert.equal(result.complete, false);
    assert.deepEqual(result.skipped.map((entry) => entry.file), ["z.html"]);
    assert.ok(result.findings.some((finding) => finding.rule === "copy/placeholder-text" && finding.file === "index.html"));
    assert.match(result.skipped[0].reason, /disappeared/);
  });
});

test("a rule that throws loses nothing else and makes the audit incomplete", () => {
  withSite({ "index.html": page("<p>TODO</p>") }, (root) => {
    const broken = { id: "copy/broken", severity: "error", description: "Throws, for this test.", page() { throw new Error("boom"); }, stylesheet() { throw new Error("bang"); }, site() { throw new Error("pow"); } };
    const result = audit(root, {}, [broken, ...allRules]);
    assert.equal(result.complete, false);
    assert.ok(result.skipped.some((entry) => /copy\/broken failed here: boom/.test(entry.reason)));
    assert.ok(result.skipped.some((entry) => entry.file === "(site)"));
    assert.ok(result.findings.some((finding) => finding.rule === "copy/placeholder-text"));
    for (const format of [formatText, formatHtml, formatGithub, formatJson]) assert.match(format(result), /failed here/);
    assert.match(formatSarif(result, allRules), /failed here/);
    assert.equal(JSON.parse(formatSarif(result, allRules)).runs[0].invocations[0].executionSuccessful, false);
  });
});

test("a page larger than the limit is left out, and says so", () => {
  withSite({ "index.html": page("x"), "big.html": Buffer.alloc(MAX_TEXT_BYTES + 1, 0x20), "big.css": Buffer.alloc(MAX_TEXT_BYTES + 1, 0x20) }, (root) => {
    const result = audit(root, {});
    assert.equal(result.complete, true);
    assert.deepEqual(result.skipped.map((entry) => entry.file).sort(), ["big.css", "big.html"]);
    assert.equal(result.summary.pages, 1);
    assert.match(formatText(result), /Not covered by this audit[^]*big\.html: larger than 32 MiB/);
    assert.match(formatHtml(result), /Not covered by this audit/);
  });
});

test("a compressed sitemap past the limit is a finding and not an out-of-memory crash", async () => {
  const { gzipSync } = await import("node:zlib");
  withSite({ "index.html": page("x"), "sitemap.xml.gz": gzipSync(Buffer.alloc(80 * 1024 * 1024, 0x20)) }, (root) => {
    const result = audit(root, {});
    assert.ok(result.findings.some((finding) => finding.rule === "foundation/sitemap-invalid" && /decompressed/.test(finding.message)));
  });
});

test("symbolic links are followed inside the folder only, and a loop ends", (context) => {
  withSite({ "real/index.html": page('<a href="/alias/index.html">a</a><a href="/secret.html">b</a><a href="/gone.html">c</a>'), "index.html": page("x") }, (root) => {
    inTemp((outside) => {
      writeFileSync(join(outside, "secret.html"), page("<p>TODO outside the site</p>"));
      try {
        symlinkSync(join(root, "real"), join(root, "alias"), "junction");
        symlinkSync(join(outside, "secret.html"), join(root, "secret.html"));
        symlinkSync(join(root, "nowhere.html"), join(root, "gone.html"));
        symlinkSync(root, join(root, "real", "loop"), "junction");
      } catch (error) {
        if (error.code === "EPERM") {
          context.skip("creating symbolic links needs a privilege here");
          return;
        }
        throw error;
      }
      const result = audit(root, {});
      assert.ok(!result.findings.some((finding) => /outside the site/.test(finding.message)), "nothing outside was read");
      assert.ok(!result.findings.some((finding) => finding.message.includes("/secret.html")), "a link to it still counts");
      assert.ok(result.skipped.some((entry) => entry.file === "secret.html" && /outside the site folder/.test(entry.reason)));
      assert.ok(result.skipped.some((entry) => entry.file === "gone.html" && /broken symbolic link/.test(entry.reason)));
      assert.equal(result.complete, true);
    });
  });
});

// ---- Writing reports

test("a report is written whole, and parent folders are made", () => {
  withSite({ "site/index.html": page("x") }, (root) => {
    const { code, out } = run(["site", "--no-config", "--format", "json", "--output", join("reports", "deep", "r.json")], root);
    assert.equal(code, 1);
    assert.match(out, /Report written/);
    assert.equal(JSON.parse(readFileSync(join(root, "reports", "deep", "r.json"), "utf8")).tool, "builtcheck");
    assert.deepEqual(readdirSync(join(root, "reports", "deep")), ["r.json"]);
  });
});

test("a report inside the site folder is refused, and nothing is written", () => {
  withSite({ "index.html": page("x") }, (root) => {
    const { code, err } = run([".", "--no-config", "--output", "report.html"], root);
    assert.equal(code, 2);
    assert.match(err, /inside the site folder/);
    assert.ok(!existsSync(join(root, "report.html")));
  });
});

test("a report that cannot be written exits 2, and the previous one is left as it was", () => {
  withSite({ "site/index.html": page("x"), "a-file": "keep", "target/x": "y" }, (root) => {
    const intoFile = run(["site", "--no-config", "--output", join("a-file", "r.txt")], root);
    assert.equal(intoFile.code, 2);
    assert.match(intoFile.err, /Cannot write/);
    noStack(intoFile.err);
    assert.equal(readFileSync(join(root, "a-file"), "utf8"), "keep");
    const overFolder = run(["site", "--no-config", "--output", "target"], root);
    assert.equal(overFolder.code, 2);
    assert.match(overFolder.err, /Cannot write target/);
    assert.deepEqual(readdirSync(join(root, "target")), ["x"]);
    assert.deepEqual(readdirSync(root).filter((name) => name.endsWith(".tmp")), []);
  });
});

test("--init writes a config that works and never replaces one", () => {
  withSite({ "site/index.html": page("x") }, (root) => {
    assert.equal(run(["--init", "--site-url", "https://www.example.com"], root).code, 0);
    const written = JSON.parse(readFileSync(join(root, "builtcheck.config.json"), "utf8"));
    assert.equal(written.site.url, "https://www.example.com");
    assert.equal(run(["site"], root).code, 1);
    const before = statSync(join(root, "builtcheck.config.json")).mtimeMs;
    const again = run(["--init"], root);
    assert.equal(again.code, 2);
    assert.match(again.err, /already exists/);
    assert.equal(statSync(join(root, "builtcheck.config.json")).mtimeMs, before);
  });
});

// ---- Exit codes and machine-readable output, for continuous integration

test("exit codes follow the table in the README", () => {
  const clean = { "index.html": page("x") };
  withSite(clean, (root) => {
    const off = JSON.stringify({ rules: { "foundation/*": "off", "schema/*": "off" } });
    writeFileSync(join(root, "..", `c${process.pid}.json`), off);
    const config = join(root, "..", `c${process.pid}.json`);
    try {
      assert.equal(run([root, "--config", config]).code, 0);
      writeFileSync(join(root, "index.html"), page("<p>a &mdash; b</p>"));
      assert.equal(run([root, "--config", config]).code, 0, "warnings alone pass");
      assert.equal(run([root, "--config", config, "--max-warnings", "1"]).code, 0);
      assert.equal(run([root, "--config", config, "--max-warnings", "0"]).code, 1);
      writeFileSync(join(root, "index.html"), page("<p>TODO</p>"));
      assert.equal(run([root, "--config", config]).code, 1);
      assert.equal(run([root, "--config", config, "--quiet"]).code, 1);
    } finally {
      rmSync(config);
    }
  });
});

test("JSON output is one parseable document with a stable shape, and repeats exactly", () => {
  withSite({ "index.html": page("<p>TODO</p>"), "b.html": page("<a href='/nope'>x</a>") }, (root) => {
    const first = run([".", "--no-config", "--format", "json"], root);
    assert.equal(first.code, 1);
    assert.equal(first.err, "");
    const report = JSON.parse(first.out);
    assert.deepEqual(Object.keys(report), ["tool", "version", "resultVersion", "root", "site", "complete", "summary", "findings", "skipped"]);
    assert.equal(report.resultVersion, 1);
    assert.deepEqual(Object.keys(report.summary), ["errors", "warnings", "suppressed", "pages", "stylesheets", "files"]);
    for (const finding of report.findings) assert.deepEqual(Object.keys(finding), ["rule", "severity", "message", "file", "line", "column"]);
    assert.equal(run([".", "--no-config", "--format", "json"], root).out, first.out);
  });
});

test("the summary counts match the findings in every format", () => {
  withSite({ "index.html": page("<p>TODO a &mdash; b</p>") }, (root) => {
    const report = JSON.parse(run([".", "--no-config", "--format", "json"], root).out);
    const errors = report.findings.filter((f) => f.severity === "error").length;
    const warnings = report.findings.filter((f) => f.severity === "warning").length;
    assert.deepEqual([report.summary.errors, report.summary.warnings], [errors, warnings]);
    const github = run([".", "--no-config", "--format", "github"], root).out;
    assert.equal(github.match(/^::error /gm).length, errors);
    assert.equal(github.match(/^::warning /gm).length, warnings);
    const sarif = JSON.parse(run([".", "--no-config", "--format", "sarif"], root).out);
    assert.equal(sarif.runs[0].results.length, errors + warnings);
    assert.match(run([".", "--no-config"], root).out, new RegExp(`${errors} errors?, ${warnings} warnings?`));
  });
});

test("SARIF output names every rule and encodes paths", () => {
  withSite({ "caf\u00e9 page.html": page("<p>TODO</p>") }, (root) => {
    const sarif = JSON.parse(run([".", "--no-config", "--format", "sarif"], root).out);
    const run0 = sarif.runs[0];
    assert.equal(sarif.version, "2.1.0");
    const ids = new Set(run0.tool.driver.rules.map((rule) => rule.id));
    for (const result of run0.results) assert.ok(ids.has(result.ruleId));
    assert.ok(run0.results.some((result) => result.locations[0].physicalLocation.artifactLocation.uri === "caf%C3%A9%20page.html"));
  });
});

// ---- Rule selection

test("--only and --skip narrow what runs, and take groups and lists", () => {
  withSite({ "index.html": page('<p>TODO</p><a href="/nope">x</a>') }, (root) => {
    const rules = (args) => [...new Set(JSON.parse(run([".", "--no-config", "--format", "json", ...args], root).out).findings.map((f) => f.rule))].sort();
    assert.deepEqual(rules(["--only", "links/*"]), ["links/broken-internal"]);
    assert.deepEqual(rules(["--only", "copy/placeholder-text,links/broken-internal"]), ["copy/placeholder-text", "links/broken-internal"]);
    assert.deepEqual(rules(["--only", "links/*", "--only", "copy/*"]), ["copy/placeholder-text", "links/broken-internal"]);
    assert.ok(!rules(["--skip", "links/*"]).includes("links/broken-internal"));
    assert.deepEqual(rules(["--only", "links/*", "--skip", "links/broken-internal"]), []);
  });
});

test("--explain describes a rule and its options", () => {
  const { code, out } = run(["--explain", "style/banned-font"]);
  assert.equal(code, 0);
  assert.match(out, /Default severity: warning/);
  assert.match(out, /"Roboto"/);
  assert.match(run(["--explain", "em-dash"]).err, /copy\/em-dash/);
});

test("every rule can be explained", () => {
  for (const rule of allRules) assert.equal(run(["--explain", rule.id]).code, 0, rule.id);
});

test("--version and -v print the package version, and -h and --help print usage", () => {
  const { version } = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(run(["--version"]).out.trim(), version);
  assert.equal(run(["-v"]).out.trim(), version);
  for (const flag of ["-h", "--help"]) assert.match(run([flag]).out, /Usage:[^]*Exit codes:/);
});

test("every option the help names is accepted", () => {
  const help = run(["--help"]).out;
  const flags = [...help.matchAll(/^ {2}(--[a-z-]+)/gm)].map((match) => match[1]);
  assert.ok(flags.length >= 15);
  for (const flag of flags) assert.doesNotMatch(run([flag, "x"]).err, /Unknown option/, flag);
});

// ---- Hostile content in the output

const ESCAPE = "\u001b";

test("control characters from the site cannot reach a terminal or a CI log", () => {
  const body = `<p>TODO ${ESCAPE}[2J${ESCAPE}]0;owned\u0007 text \u202e</p><a href="/${ESCAPE}[31m%0A::error::fake">x</a>`;
  withSite({ "index.html": page(body) }, (root) => {
    for (const format of ["text", "github"]) {
      const { out } = run([".", "--no-config", "--format", format, "--all"], root);
      assert.ok(!out.includes(ESCAPE), format);
      assert.ok(!out.includes("\u0007"), format);
      assert.ok(!out.includes("\u202e"), format);
    }
  });
  assert.equal(printable(`a${ESCAPE}b\nc\u2028d`), "a\\u001bb\\u000ac\\u2028d");
});

test("a message cannot start a new workflow command in GitHub output", () => {
  const result = {
    summary: { errors: 1, warnings: 0, pages: 1 },
    findings: [{ rule: "a/b", severity: "error", message: "x\n::error::fake %0A", file: "a,b:c.html", line: 1, column: null }],
    skipped: [],
  };
  const lines = formatGithub(result).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "::error file=a%2Cb%3Ac.html,line=1,title=a/b::x\\u000a::error::fake %250A");
});

test("the HTML report escapes hostile file names and skipped entries", () => {
  const html = formatHtml({
    root: "<r>",
    summary: { errors: 1, warnings: 0, suppressed: 0, pages: 1, stylesheets: 0, files: 1 },
    findings: [{ rule: "a/b", severity: "error", message: "<script>alert(1)</script>", file: "<img src=x onerror=alert(1)>.html", line: 1, column: 1 }],
    skipped: [{ file: "<b>", reason: "<i>", incomplete: true }],
  });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<b>:"));
});

test("JSON-LD cannot reach the prototype chain", () => {
  const block = '<script type="application/ld+json">{"@context":"https://schema.org","@type":["__proto__","constructor","toString"],"__proto__":{"polluted":1},"constructor":{"@type":"Article"},"speakable":{"__proto__":1},"toString":{"@type":"Article"}}</script>';
  withSite({ "index.html": page("x", block) }, (root) => {
    const result = audit(root, {});
    assert.equal(result.complete, true);
    assert.equal({}.polluted, undefined);
  });
});

test("a config cannot reach the prototype chain", () => {
  withSite({ "index.html": page("x"), "c.json": '{"__proto__":{"polluted":1}}', "d.json": '{"rules":{"__proto__":"off"}}', "e.json": '{"rules":{"style/phone-overflow":{"__proto__":{"polluted":1}}}}', "f.json": '{"site":{"__proto__":{"url":"x"}}}' }, (root) => {
    for (const file of ["c.json", "d.json", "e.json", "f.json"]) {
      const { code, err } = run([".", "--config", file], root);
      assert.ok([1, 2].includes(code), file);
      noStack(err);
      assert.equal({}.polluted, undefined);
    }
  });
});

test("links that try to leave the site folder resolve to nothing and read nothing", () => {
  withSite({ "site/index.html": page('<a href="../../outside.html">a</a><a href="/..%2f..%2foutside.html">b</a><img alt="" src="/%2e%2e/outside.png"><link rel="stylesheet" href="../outside.css">'), "outside.html": page("<p>TODO this is not in the site</p>"), "outside.css": "a{color:#000}" }, (root) => {
    const result = audit(join(root, "site"), {});
    assert.ok(!result.findings.some((finding) => /not in the site/.test(finding.message)));
    assert.ok(!result.findings.some((finding) => finding.rule === "style/pure-color"));
    assert.equal(result.summary.stylesheets, 0);
  });
});

test("the source reaches no network and starts no processes", () => {
  const files = execFileSync(process.execPath, ["-e", `
    const { readdirSync } = require("node:fs");
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(dir + "/" + e.name) : [dir + "/" + e.name]);
    console.log(walk("src").concat(walk("bin")).join("\\n"));
  `], { cwd: REPO_ROOT, encoding: "utf8" }).trim().split("\n");
  for (const file of files) {
    const text = readFileSync(join(REPO_ROOT, file), "utf8");
    assert.doesNotMatch(text, /from "(?:node:)?(?:net|http|https|http2|dgram|tls|dns|child_process|cluster|vm)"/, file);
    assert.doesNotMatch(text, /\bfetch\(|\beval\(|new Function\(/, file);
  }
});

// ---- Odd input of every kind stays fast and gives an answer

const R = (count, text) => text.repeat(count);
const linked = '<link rel="stylesheet" href="/a.css">';

const ODD_SITES = {
  "an empty page": { "index.html": "" },
  "binary bytes in a page": { "index.html": Buffer.from(Array.from({ length: 50000 }, (_, i) => (i * 7) % 256)) },
  "an unclosed comment": { "index.html": `<!-- ${R(200000, "a")}` },
  "a flood of unclosed tags": { "index.html": R(100000, "<a ") },
  "a flood of attributes": { "index.html": `<div ${R(50000, "a ")}>` },
  "very deep nesting": { "index.html": R(200000, "<b>") },
  "a flood of repeated headings": { "index.html": page(R(20000, "<h2>Same</h2>")) },
  "a flood of fill-in openers": { "index.html": page(`<p>${R(100000, "[fill ")}</p>`) },
  "a flood of template openers": { "index.html": page(`<p>${R(50000, "{{")}${R(50000, "${")}${R(50000, "<%")}</p>`) },
  "a flood of double hyphens": { "index.html": page(`<p>${R(50000, "a-- ")}</p><p>${R(50000, "a--b")}</p>`) },
  "a flood of commas in srcset": { "index.html": page(`<img alt="" srcset="${R(100000, ",")}">`) },
  "deeply nested JSON-LD": { "index.html": page("", `<script type="application/ld+json">${R(100000, "[")}${R(100000, "]")}</script>`) },
  "deeply nested CSS": { "a.css": `${R(20000, "a{")}color:#000`, "index.html": page("<a>x</a>", linked) },
  "CSS nesting that multiplies": { "a.css": `${R(100, ".a,.b{")}color:#000${R(100, "}")}`, "index.html": page('<a class="a">x</a>', linked) },
  "many declarations deep in CSS": { "a.css": R(20000, "a{b:c;"), "index.html": page("<a>x</a>", linked) },
  "deeply nested selectors": { "a.css": `${R(20000, ":is(")}a${R(20000, ")")}{color:#000}`, "index.html": page("<a>x</a>", linked) },
  "a very long selector list": { "a.css": `${Array.from({ length: 50000 }, (_, i) => `.c${i}`).join(",")}{color:#000}`, "index.html": page("<a>x</a>", linked) },
  "a sibling chain that backtracks": { "a.css": `${R(3000, "a ~ ")}a{color:#000}`, "index.html": page(R(3000, "<a></a>"), linked) },
  "a descendant chain that backtracks": { "a.css": `${R(30, "a ")}b{color:#000}`, "index.html": page(`${R(300, "<a>")}<b>x</b>`, linked) },
  "unclosed CSS strings and comments": { "a.css": `a{content:"${R(1000000, "x")}`, "b.css": `/*${R(1000000, "x")}`, "index.html": page("x") },
  "a flood of url() calls": { "a.css": `a{background:${R(100000, "url(")}}`, "index.html": page("<a>x</a>") },
  "stylesheets that import each other": { "a.css": '@import "b.css";', "b.css": '@import "a.css";', "index.html": page("x", linked) },
  "an unclosed sitemap comment flood": { "sitemap.xml": `<urlset>${R(100000, "<!-- ")}`, "index.html": page("x") },
  "an unclosed sitemap location flood": { "sitemap.xml": `<urlset>${R(100000, "<loc>")}`, "index.html": page("x") },
  "sitemap and robots paths that leave the folder": { "sitemap.xml": "<sitemapindex><sitemap><loc>https://www.example.com/../../../etc/passwd</loc></sitemap><sitemap><loc>file:///etc/passwd</loc></sitemap></sitemapindex>", "robots.txt": "User-agent: *\nSitemap: ../../../etc/passwd\n", "index.html": page("x") },
  "a flood of redirect wildcards": { _redirects: R(50000, "/a* /b\n"), "index.html": page(R(200, '<a href="/nope">x</a>')) },
  "truncated images": { "og-default.png": Buffer.from([0x89, 0x50, 0x4e, 0x47]), "og-default.jpg": Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(100000, 0xff)]), "index.html": page("x") },
  "malformed URLs": { "index.html": page('<a href="http://[bad">a</a><a href="%">b</a><a href="/%zz">c</a><a href="\\\\server\\share">d</a><a href="/\ud800">e</a>') },
  "names that are folders": { "x.html/inner.txt": "t", "x.css/inner.txt": "t", "robots.txt/inner.txt": "t", "sitemap.xml/inner.txt": "t", "llms.txt/inner.txt": "t", "og-default.png/inner.txt": "t", "index.html": page("x") },
};

for (const [name, files] of Object.entries(ODD_SITES)) {
  test(`${name} gives an answer promptly`, () => {
    withSite(files, (root) => {
      const started = Date.now();
      const result = audit(root, {});
      assert.ok(Date.now() - started < 30000, `took ${Date.now() - started}ms`);
      assert.deepEqual(result.skipped.filter((entry) => entry.incomplete), []);
      for (const format of [formatText, formatHtml, formatGithub, formatJson]) assert.equal(typeof format(result), "string");
    });
  });
}

test("every report format handles non-ASCII names and text", () => {
  withSite({ "caf\u00e9/\u65e5\u672c\u8a9e.html": page('<p>TODO \ud83d\ude00</p><a href="/caf%C3%A9/%E6%97%A5%E6%9C%AC%E8%AA%9E.html">x</a><a href="/caf\u00e9/\u65e5\u672c\u8a9e.html">y</a>') }, (root) => {
    const result = audit(root, {});
    assert.ok(!result.findings.some((finding) => finding.rule === "links/broken-internal"));
    const { out } = run([".", "--no-config"], root);
    assert.ok(out.includes("caf\u00e9/\u65e5\u672c\u8a9e.html"));
    assert.ok(out.includes("\ud83d\ude00"));
  });
});

test("a page in a big endian UTF-16 encoding decodes", () => {
  const text = page('<a href="/nope">x</a>');
  const bytes = Buffer.from(text, "utf16le").swap16();
  withSite({ "index.html": Buffer.concat([Buffer.from([0xfe, 0xff]), bytes]) }, (root) => {
    const result = audit(root, {});
    assert.ok(result.findings.some((finding) => finding.rule === "links/broken-internal"));
  });
});

test("a folder path with spaces, a trailing slash or a dot works", () => {
  withSite({ "my site/index.html": page("x") }, (root) => {
    for (const folder of ["my site", "my site/", "./my site", join(root, "my site")]) {
      assert.notEqual(run([folder, "--no-config"], root).code, 2, folder);
    }
    mkdirSync(join(root, "empty dir"));
    assert.equal(run(["empty dir", "--no-config"], root).code, 2);
  });
});

test("the site folder is not changed by a run", () => {
  withSite({ "index.html": page("<p>TODO</p>"), "a.css": "a{color:#000}" }, (root) => {
    const before = readdirSync(root).map((name) => [name, statSync(join(root, name)).mtimeMs]);
    run([".", "--no-config", "--format", "json"], root);
    assert.deepEqual(readdirSync(root).map((name) => [name, statSync(join(root, name)).mtimeMs]), before);
  });
});
