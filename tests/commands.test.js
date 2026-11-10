// The results store from the command line, through main(): saving with an audit, history, show,
// compare, import and the store commands, with their output formats and exit codes.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { COMMANDS } from "../src/commands/index.js";
import { page, withSite } from "./helpers.js";

// Runs main() with captured output, from `cwd` when given.
function cli(argv, cwd) {
  let out = "";
  let err = "";
  const previous = process.cwd();
  if (cwd) process.chdir(cwd);
  try {
    const code = main(argv, { stdout: (text) => (out += text), stderr: (text) => (err += text), isTty: false });
    return { code, out, err };
  } finally {
    process.chdir(previous);
  }
}

function inTemp(fn) {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-commands-"));
  try {
    return fn(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const BROKEN = page('<a href="/menu/">Menu</a> <a href="/about/">About</a><p>Lorem ipsum dolor sit amet.</p>');
const FIXED = page('<a href="/about/">About</a><p>Fresh bread every morning.</p>');
const ABOUT = page("<p>About Example Bakery.</p>");

// The rule groups these small sites are audited with, so the foundation files they lack do not
// fill every run with the same errors.
const ONLY = ["--no-config", "--only", "links/*,copy/*"];

// A site with problems, saved, then fixed and saved again, in a store outside it.
function twoRuns(fn) {
  return inTemp((folder) => {
    const site = join(folder, "site");
    const store = join(folder, "store");
    mkdirSync(join(site, "about"), { recursive: true });
    writeFileSync(join(site, "index.html"), BROKEN);
    writeFileSync(join(site, "about", "index.html"), ABOUT);
    const first = cli([site, ...ONLY, "--save", "--store", store, "--label", "before-fix"]);
    writeFileSync(join(site, "index.html"), FIXED);
    const second = cli([site, ...ONLY, "--save", "--store", store]);
    return fn({ folder, site, store, first, second });
  });
}

const idIn = (text) => /saved as run (\d{8}-\d{6}-\d{3})/.exec(text)?.[1];

test("--save keeps the audit's output and exit code and says where the run went", () => {
  twoRuns(({ first, second, store }) => {
    assert.equal(first.code, 1);
    assert.match(first.out, /links\/broken-internal/);
    assert.match(first.err, /^builtcheck: saved as run \d{8}-\d{6}-\d{3} in .*store\n$/);
    assert.equal(second.code, 0);
    assert.ok(idIn(first.err) < idIn(second.err));
    assert.deepEqual(readdirSync(join(store, "runs")).sort(), [`${idIn(first.err)}.json`, `${idIn(second.err)}.json`]);
  });
});

test("store.save and store.path in the config file save every run, and --store overrides the path", () => {
  withSite({ "index.html": page("<p>Example Bakery</p>") }, (site) => {
    inTemp((folder) => {
      const rules = { "*": "off", "links/*": "error" };
      writeFileSync(join(folder, "builtcheck.config.json"), JSON.stringify({ rules, store: { path: "history", save: true } }));
      const { code, err } = cli([site], folder);
      assert.equal(code, 0);
      assert.match(err, /saved as run .* in history/);
      assert.equal(readdirSync(join(folder, "history", "runs")).length, 1);
      assert.match(cli([site, "--store", "elsewhere"], folder).err, /in elsewhere/);
      assert.ok(existsSync(join(folder, "elsewhere", "store.json")));
      // The default store, with no path set, is .builtcheck in the current folder.
      writeFileSync(join(folder, "builtcheck.config.json"), JSON.stringify({ rules, store: { save: true } }));
      assert.match(cli([site], folder).err, /in \.builtcheck/);
      const history = cli(["history"], folder);
      assert.equal(history.code, 0);
      assert.match(history.out, /1 run in \.builtcheck/);
    });
  });
});

test("saving is refused before the audit when the store is inside the site, or the label or store is wrong", () => {
  withSite({ "index.html": page("<p>Example Bakery</p>") }, (site) => {
    const inside = cli([site, "--no-config", "--save", "--store", join(site, ".builtcheck")]);
    assert.equal(inside.code, 2);
    assert.equal(inside.out, "", "no audit ran");
    assert.match(inside.err, /inside the site folder/);
    assert.ok(!existsSync(join(site, ".builtcheck")));
    assert.equal(cli([site, "--no-config", "--save"], site).code, 2, "the default store in the site folder");
    const label = cli([site, "--no-config", "--label", "x"]);
    assert.equal(label.code, 2);
    assert.match(label.err, /--label names a saved run, so it needs --save/);
    inTemp((folder) => {
      assert.match(cli([site, "--no-config", "--save", "--store", folder, "--label", "a\u0007b"]).err, /A label must be one line/);
      writeFileSync(join(folder, "notes.txt"), "x");
      const notStore = cli([site, "--no-config", "--save", "--store", folder]);
      assert.equal(notStore.code, 2);
      assert.equal(notStore.out, "");
      assert.match(notStore.err, /is not a results store/);
    });
  });
});

test("history lists runs newest first, with a trend line, and as JSON", () => {
  twoRuns(({ store, first, second }) => {
    const text = cli(["history", "--store", store]);
    assert.equal(text.code, 0);
    const lines = text.out.split("\n");
    assert.match(lines[0], /^2 runs in .*store, newest first$/);
    assert.match(lines[2], /^ID\s+DATE\s+ERRORS\s+WARNINGS\s+PAGES\s+STATUS\s+LABEL\s+FOLDER$/);
    assert.ok(lines[3].startsWith(idIn(second.err)));
    assert.ok(lines[4].startsWith(idIn(first.err)));
    assert.match(lines[4], /complete\s+before-fix\s+.*site$/);
    assert.match(text.out, /Errors, oldest to newest: 2, 0 \(down 2\)/);
    const limited = cli(["history", "--store", store, "--limit", "1"]);
    assert.match(limited.out, /The newest 1 of 2 runs/);
    const data = JSON.parse(cli(["history", "--store", store, "--format", "json"]).out);
    assert.equal(data.total, 2);
    assert.equal(data.storeVersion, 2);
    assert.deepEqual(data.runs.map((run) => run.id), [idIn(second.err), idIn(first.err)]);
    assert.deepEqual(Object.keys(data.runs[0]).slice(0, 6), ["id", "ranAt", "savedAt", "label", "folder", "toolVersion"]);
    assert.equal(data.runs[1].errors, 2);
  });
});

test("history on an empty or missing store says how to save a run", () => {
  inTemp((folder) => {
    const result = cli(["history", "--store", join(folder, "none")]);
    assert.equal(result.code, 0);
    assert.match(result.out, /No runs saved in .* yet. Save one with: builtcheck <folder> --save/);
    assert.deepEqual(JSON.parse(cli(["history", "--store", join(folder, "none"), "--format", "json"]).out).runs, []);
  });
});

test("show renders a saved run in any report format, to stdout or a file", () => {
  twoRuns(({ folder, store, first }) => {
    const text = cli(["show", "latest~1", "--store", store]);
    assert.equal(text.code, 0, text.err);
    assert.match(text.out, new RegExp(`^Run ${idIn(first.err)} \\(before-fix\\) of .*site, audited \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d by builtcheck \\d`));
    assert.match(text.out, /Link \/menu\/ does not resolve/);
    const json = JSON.parse(cli(["show", idIn(first.err), "--store", store, "--format", "json"]).out);
    const saved = JSON.parse(readFileSync(join(store, "runs", `${idIn(first.err)}.json`), "utf8")).result;
    assert.deepEqual(json, saved);
    assert.match(cli(["show", "latest", "--store", store, "--format", "sarif"]).out, /"version": "2.1.0"/);
    const output = join(folder, "report.html");
    const written = cli(["show", "latest~1", "--store", store, "--format", "html", "--output", output]);
    assert.equal(written.code, 0);
    assert.match(written.out, /written to .*report.html/);
    assert.match(readFileSync(output, "utf8"), /<html/i);
    const quiet = cli(["show", "latest~1", "--store", store, "--quiet"]);
    assert.doesNotMatch(quiet.out, /warning /);
  });
});

test("show refuses what it cannot do with exit code 2 and a plain message", () => {
  twoRuns(({ site, store }) => {
    const cases = [
      [["show", "--store", store], /Give the run to show/],
      [["show", "a", "b", "--store", store], /Give one run to show/],
      [["show", "latest", "--store", store, "--format", "xml"], /--format must be text, json, html/],
      [["show", "latest~9", "--store", store], /latest~9 does not exist/],
      [["show", "1999", "--store", store], /No run in .* has an id starting "1999"/],
      [["show", "latest", "--store", store, "--output", join(store, "runs", "x.json")], /inside the results store/],
      [["show", "latest", "--store", store, "--output", join(site, "report.html")], /inside the site folder/],
      [["show", "latest", "--store", store, "--colour"], /Unknown option for builtcheck show: --colour/],
    ];
    for (const [argv, message] of cases) {
      const result = cli(argv);
      assert.equal(result.code, 2, argv.join(" "));
      assert.match(result.err, message, argv.join(" "));
    }
  });
});

test("compare shows what is new, gone and still present, and exits 0 either way", () => {
  twoRuns(({ store, first, second }) => {
    const text = cli(["compare", "--store", store]);
    assert.equal(text.code, 0);
    assert.match(text.out, new RegExp(`^Comparing run ${idIn(first.err)} \\(before-fix\\) with run ${idIn(second.err)}\n`));
    assert.match(text.out, /Errors\s+2\s+0\s+-2/);
    assert.match(text.out, /0 new, \d+ gone, \d+ still present\./);
    assert.match(text.out, /Gone since .*\n  index.html:1:\d+  error    Link \/menu\/ does not resolve/);
    assert.match(text.out, /Changes by rule\n(?: {2}.*\n)* {2}links\/broken-internal\s+1 -> 0\s+1 gone\n/);
    // The other way round, things got worse, and it still exits 0.
    const backwards = cli(["compare", "latest", "latest~1", "--store", store]);
    assert.equal(backwards.code, 0);
    assert.match(backwards.out, /2 new/);
    assert.match(backwards.out, /Notes\n  Run .* is newer than run/);
    const data = JSON.parse(cli(["compare", "latest~1", "--store", store, "--format", "json"]).out);
    assert.deepEqual(Object.keys(data), ["before", "after", "notes", "summary", "rules", "added", "gone", "still"]);
    assert.equal(data.before.id, idIn(first.err));
    assert.equal(data.summary.before.errors, 2);
    assert.equal(data.summary.after.errors, 0);
    assert.equal(data.gone.some((finding) => finding.rule === "links/broken-internal"), true);
    assert.ok(data.still.every((finding) => finding.previous && "line" in finding.previous));
    const all = cli(["compare", "latest~1", "latest~1", "--store", store, "--all"]);
    assert.match(all.out, /0 new, 0 gone, 2 still present\.\n\nStill present\n {2}index.html:1:\d+ {2}error {4}Link \/menu\//);
    assert.doesNotMatch(text.out, /Still present/, "only --all lists them");
  });
});

test("compare notes when different settings or folders could explain a change", () => {
  withSite({ "index.html": BROKEN }, (site) => {
    inTemp((folder) => {
      const store = join(folder, "store");
      cli([site, "--no-config", "--save", "--store", store]);
      cli([site, "--no-config", "--save", "--store", store, "--skip", "copy/*"]);
      const text = cli(["compare", "--store", store]).out;
      assert.match(text, /The runs used different settings/);
      assert.doesNotMatch(text, /different folders/);
      assert.match(cli(["compare", "latest", "latest", "--store", store]).out, /Both names lead to the same run/);
    });
  });
});

test("compare needs two runs, and says so", () => {
  withSite({ "index.html": FIXED, "about/index.html": ABOUT }, (site) => {
    inTemp((folder) => {
      const store = join(folder, "store");
      assert.match(cli(["compare", "--store", store]).err, /holds 0 runs/);
      cli([site, "--no-config", "--save", "--store", store]);
      const one = cli(["compare", "--store", store]);
      assert.equal(one.code, 2);
      assert.match(one.err, /Comparing needs two runs, and .* holds 1 run\. Save another/);
      assert.equal(cli(["compare", "a", "b", "c", "--store", store]).code, 2);
    });
  });
});

test("import adds JSON reports as runs dated from their files, once each", () => {
  withSite({ "index.html": BROKEN }, (site) => {
    inTemp((folder) => {
      const report = join(folder, "report.json");
      const store = join(folder, "store");
      cli([site, "--no-config", "--format", "json", "--output", report]);
      const when = Date.UTC(2026, 9, 1, 8, 0, 0);
      utimesSync(report, when / 1000, when / 1000);
      const added = cli(["import", report, "--store", store, "--label", "october"]);
      assert.equal(added.code, 0, added.err);
      assert.match(added.out, /Added .*report.json as run 20261001-080000-000\n1 run added to/);
      const again = cli(["import", report, "--store", store]);
      assert.match(again.out, /Left out .*: it is already in the store as run 20261001-080000-000\n0 runs added/);
      const listed = JSON.parse(cli(["history", "--store", store, "--format", "json"]).out).runs;
      assert.deepEqual(listed.map((run) => [run.id, run.label, run.source]), [["20261001-080000-000", "october", "import"]]);
      // A report saved with --save as well is the same report.
      cli([site, "--no-config", "--save", "--store", join(folder, "other")]);
      assert.match(cli(["import", report, "--store", join(folder, "other"), "--format", "json"]).out, /"skipped": \[\n\s+\{/);
    });
  });
});

test("import refuses files that are not reports, and adds nothing when one of several is bad", () => {
  inTemp((folder) => {
    const store = join(folder, "store");
    writeFileSync(join(folder, "notes.json"), '{"hello": "world"}');
    writeFileSync(join(folder, "broken.json"), "{");
    const good = { tool: "builtcheck", version: "1.0.0", resultVersion: 1, root: "dist", complete: true, summary: { errors: 0, warnings: 0, pages: 1 }, findings: [], skipped: [] };
    writeFileSync(join(folder, "good.json"), JSON.stringify(good));
    const cases = [
      [["import", join(folder, "notes.json")], /notes.json is not a builtcheck JSON report/],
      [["import", join(folder, "broken.json")], /broken.json is damaged: it is not valid JSON/],
      [["import", join(folder, "missing.json")], /Cannot read .*missing.json: no such file or folder/],
      [["import", folder], /is not a file/],
      [["import"], /Give the JSON report to import/],
      [["import", join(folder, "good.json"), join(folder, "notes.json")], /notes.json is not a builtcheck JSON report/],
    ];
    for (const [argv, message] of cases) {
      const result = cli([...argv, "--store", store]);
      assert.equal(result.code, 2, argv.join(" "));
      assert.match(result.err, message);
    }
    assert.ok(!existsSync(store), "nothing was created");
    // A report from PowerShell's "> report.json" is UTF-16 with a byte order mark.
    writeFileSync(join(folder, "utf16.json"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(good), "utf16le")]));
    assert.equal(cli(["import", join(folder, "utf16.json"), "--store", store]).code, 0);
  });
});

test("a folder of JSON reports reads as a store, and migrate converts it so runs can be saved", () => {
  withSite({ "index.html": BROKEN }, (site) => {
    inTemp((folder) => {
      const reports = join(folder, "reports");
      mkdirSync(reports);
      cli([site, "--no-config", "--format", "json", "--output", join(reports, "one.json")]);
      cli([site, "--no-config", "--format", "json", "--output", join(reports, "two.json"), "--skip", "copy/*"]);
      utimesSync(join(reports, "one.json"), 1700000000, 1700000000);
      const history = cli(["history", "--store", reports]);
      assert.equal(history.code, 0);
      assert.match(history.out, /2 runs in/);
      assert.match(history.err, /is a folder of JSON reports, which reads as it is.*builtcheck store migrate/);
      assert.equal(cli(["show", "latest", "--store", reports]).code, 0);
      assert.equal(cli(["compare", "--store", reports]).code, 0);
      const info = cli(["store", "info", "--store", reports]);
      assert.match(info.out, /Format\s+1, a folder of JSON reports/);
      const refused = cli([site, "--no-config", "--save", "--store", reports]);
      assert.equal(refused.code, 2);
      assert.match(refused.err, /Convert it first, keeping every report, with: builtcheck store migrate/);
      assert.equal(cli(["import", join(reports, "one.json"), "--store", reports]).code, 2);
      const ids = JSON.parse(cli(["history", "--store", reports, "--format", "json"]).out).runs.map((run) => run.id);

      const migrated = cli(["store", "migrate", reports]);
      assert.equal(migrated.code, 0, migrated.err);
      assert.match(migrated.out, /Converted .*reports from store format 1 to 2\.\n  one.json is now run \d+-\d+-\d+\n  two.json is now run/);
      assert.match(migrated.out, /The original reports are now in .*reports-before-migration/);
      assert.deepEqual(JSON.parse(cli(["history", "--store", reports, "--format", "json"]).out).runs.map((run) => run.id), ids);
      assert.equal(cli([site, "--no-config", "--save", "--store", reports]).code, 1);
      assert.match(cli(["store", "migrate", "--store", reports]).out, /already in store format 2, the current one/);
      assert.equal(JSON.parse(cli(["store", "migrate", reports, "--format", "json"]).out).changed, false);
    });
  });
});

test("store info and verify describe the store, and verify exits 1 on problems until they are fixed", () => {
  twoRuns(({ store, first }) => {
    const info = cli(["store", "info", "--store", store]);
    assert.equal(info.code, 0);
    assert.match(info.out, /Format\s+2, the current format\n\s+Runs\s+2\n\s+Size\s+[\d.]+ KB/);
    const data = JSON.parse(cli(["store", "info", "--store", store, "--format", "json"]).out);
    assert.equal(data.runs, 2);
    assert.equal(data.oldest.id, idIn(first.err));
    assert.ok(data.bytes > 0);
    assert.equal(cli(["store", "verify", "--store", store]).code, 0);
    rmSync(join(store, "index.json"));
    const broken = cli(["store", "verify", "--store", store]);
    assert.equal(broken.code, 1);
    assert.match(broken.out, /index.json is missing\.\n1 problem found\.\nTo write the index again from the run files, run: builtcheck store verify --rebuild-index/);
    const fixed = cli(["store", "verify", "--store", store, "--rebuild-index"]);
    assert.equal(fixed.code, 0);
    assert.match(fixed.out, /Rebuilt the index from 2 readable runs, which fixed 1 problem with it\.\nNo problems found\./);
    writeFileSync(join(store, "runs", `${idIn(first.err)}.json`), "{");
    const damaged = cli(["store", "verify", "--store", store, "--format", "json"]);
    assert.equal(damaged.code, 1);
    assert.equal(JSON.parse(damaged.out).problems[0].run, idIn(first.err));
    const history = cli(["history", "--store", store]);
    assert.equal(history.code, 0, "a damaged run does not stop the listing");
    assert.match(cli(["show", idIn(first.err), "--store", store]).err, /is damaged: it is not valid JSON/);
    assert.match(cli(["store", "info", "--store", join(store, "none")]).out, /There is no results store at .* yet/);
  });
});

test("store prune removes old runs by count or age, and can show what it would do first", () => {
  inTemp((folder) => {
    const store = join(folder, "store");
    const report = { tool: "builtcheck", version: "1.0.0", resultVersion: 1, root: "dist", complete: true, summary: { errors: 0, warnings: 0, pages: 1 }, findings: [], skipped: [] };
    const days = [400, 200, 30, 1];
    days.forEach((age, index) => {
      const file = join(folder, `r${index}.json`);
      writeFileSync(file, JSON.stringify({ ...report, summary: { ...report.summary, errors: index } }));
      const when = (Date.now() - age * 86400000) / 1000;
      utimesSync(file, when, when);
    });
    assert.equal(cli(["import", ...days.map((_, index) => join(folder, `r${index}.json`)), "--store", store]).code, 0);
    const dry = cli(["store", "prune", "--keep", "3", "--dry-run", "--store", store]);
    assert.match(dry.out, /^Would remove 1 run from .*, keeping 3:\n  \d/);
    assert.equal(readdirSync(join(store, "runs")).length, 4);
    const aged = JSON.parse(cli(["store", "prune", "--older-than", "100", "--store", store, "--format", "json"]).out);
    assert.equal(aged.removed.length, 2);
    assert.equal(aged.kept, 2);
    assert.deepEqual(JSON.parse(cli(["history", "--store", store, "--format", "json"]).out).runs.map((run) => run.errors), [3, 2]);
    assert.match(cli(["store", "prune", "--keep", "1", "--store", store]).out, /^Removed 1 run from .*, keeping 1/);
    assert.match(cli(["store", "prune", "--keep", "5", "--store", store]).out, /Nothing to remove/);
    assert.equal(cli(["store", "verify", "--store", store]).code, 0);
    assert.match(cli(["store", "prune", "--store", store]).err, /Say what to remove with --keep/);
    assert.match(cli(["store", "prune", "--keep", "many", "--store", store]).err, /--keep needs a whole number/);
  });
});

test("the store command refuses unknown actions and options that belong to another action", () => {
  const cases = [
    [["store"], /Give a store command: info, verify, prune or migrate/],
    [["store", "clean"], /builtcheck store clean is not a store command/],
    [["store", "info", "--keep", "2"], /--keep belongs to builtcheck store prune, not info/],
    [["store", "verify", "extra"], /takes no folder/],
    [["store", "info", "--format", "html"], /--format must be text or json/],
    [["history", "dist"], /takes no folder or run/],
    [["history", "--limit", "0"], /--limit needs a number above 0/],
    [["history", "--limit=x"], /--limit needs a whole number/],
    [["history", "--nope"], /Unknown option for builtcheck history: --nope/],
    [["history", "--store"], /--store needs a value/],
    [["history", "--config", "x.json", "--no-config"], /cannot be combined/],
  ];
  for (const [argv, message] of cases) {
    const result = cli(argv);
    assert.equal(result.code, 2, argv.join(" "));
    assert.match(result.err, message, argv.join(" "));
  }
});

test("store commands read the store path from the config file, and report a bad config", () => {
  inTemp((folder) => {
    writeFileSync(join(folder, "builtcheck.config.json"), JSON.stringify({ store: { path: "kept-runs" } }));
    assert.match(cli(["history"], folder).out, /No runs saved in kept-runs yet/);
    assert.match(cli(["history", "--no-config"], folder).out, /No runs saved in \.builtcheck yet/);
    writeFileSync(join(folder, "builtcheck.config.json"), JSON.stringify({ store: { path: 5 } }));
    const bad = cli(["history"], folder);
    assert.equal(bad.code, 2);
    assert.match(bad.err, /store.path must be a folder path/);
  });
});

test("every command has its own help, and the main help lists them", () => {
  const help = cli(["--help"]).out;
  for (const name of Object.keys(COMMANDS)) {
    assert.ok(help.includes(`builtcheck ${name}`), name);
    for (const flag of ["--help", "-h"]) {
      const result = cli([name, flag]);
      assert.equal(result.code, 0, `${name} ${flag}`);
      assert.ok(result.out.startsWith(`builtcheck ${name}: `), `${name} ${flag}`);
      assert.match(result.out, /--store <folder>/);
    }
  }
  assert.match(help, /--label <text>/);
});

test("a folder named like a command can still be audited as ./name", () => {
  inTemp((folder) => {
    mkdirSync(join(folder, "history"));
    writeFileSync(join(folder, "history", "index.html"), page("<p>Example Bakery</p>"));
    const result = cli(["./history", ...ONLY], folder);

    assert.equal(result.code, 0, result.err);
    assert.match(result.out, /No problems found/);
  });
});
