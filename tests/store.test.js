// The results store as a library: layout, ids and names of runs, safe writes, the lock, older
// formats and their migration, result upgrades, git metadata and comparing results.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { audit, RESULT_VERSION } from "../src/audit.js";
import { ConfigError } from "../src/engine/config.js";
import { checkLabel, checkSaveTarget, compareResults, configDigest, migrateStore, openStore, saveRun, STORE_VERSION, StoreError, upgradeResult } from "../src/store/index.js";
import { LOCK_FILE, withLock, writeWhole } from "../src/store/files.js";
import { gitState } from "../src/store/git.js";
import { freeId, idFor } from "../src/store/store.js";
import { page, REPO_ROOT, withSite } from "./helpers.js";

function inTemp(fn) {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-store-"));
  try {
    return fn(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function finding(rule, file, line, message = `${rule} message`, severity = "error") {
  return { rule, severity, message, file, line, column: 1 };
}

// A result in the shape audit() returns, with the findings given.
function result(findings, extra = {}) {
  const count = (severity) => findings.filter((entry) => entry.severity === severity).length;
  return {
    tool: "builtcheck",
    version: "1.0.0",
    resultVersion: RESULT_VERSION,
    root: "dist",
    site: { host: null, basePath: "/" },
    complete: true,
    summary: { errors: count("error"), warnings: count("warning"), suppressed: 0, pages: 2, stylesheets: 0, files: 2 },
    findings,
    skipped: [],
    ...extra,
  };
}

const T0 = Date.UTC(2026, 10, 1, 9, 30, 0, 5);

function save(storeFolder, res, at, extra = {}) {
  return saveRun(res, { store: { path: storeFolder }, folder: "dist", now: at, cwd: storeFolder, ...extra });
}

test("a run id is the UTC time to the millisecond, and a taken id moves on a millisecond", () => {
  assert.equal(idFor(T0), "20261101-093000-005");
  const taken = new Set(["20261101-093000-005", "20261101-093000-006"]);
  assert.equal(freeId(T0, taken), "20261101-093000-007");
  assert.ok(idFor(T0) < idFor(T0 + 1) && idFor(T0 + 1) < idFor(T0 + 86400000));
});

test("saving creates the store layout, with metadata, the full result and an index", () => {
  inTemp((folder) => {
    const path = join(folder, "history");
    const saved = save(path, result([finding("links/broken-internal", "index.html", 4)]), T0, { label: "release-1" });
    assert.equal(saved.id, "20261101-093000-005");
    const marker = JSON.parse(readFileSync(join(path, "store.json"), "utf8"));
    assert.equal(marker.format, "builtcheck results store");
    assert.equal(marker.storeVersion, STORE_VERSION);
    const run = JSON.parse(readFileSync(join(path, "runs", `${saved.id}.json`), "utf8"));
    assert.equal(run.storeVersion, STORE_VERSION);
    assert.equal(run.meta.label, "release-1");
    assert.equal(run.meta.folder, "dist");
    assert.equal(run.meta.toolVersion, "1.0.0");
    assert.equal(run.meta.ranAt, new Date(T0).toISOString());
    assert.match(run.meta.configDigest, /^[0-9a-f]{64}$/);
    assert.match(run.meta.resultDigest, /^[0-9a-f]{64}$/);
    assert.equal(run.result.findings.length, 1);
    const index = JSON.parse(readFileSync(join(path, "index.json"), "utf8"));
    assert.deepEqual(index.runs.map((entry) => [entry.id, entry.errors, entry.label]), [[saved.id, 1, "release-1"]]);
    assert.ok(!existsSync(join(path, LOCK_FILE)), "the lock is released");
    assert.deepEqual(readdirSync(path).filter((name) => name.endsWith(".tmp")), []);
  });
});

test("runs are named by id, unique prefix, latest and latest~N, with plain messages otherwise", () => {
  inTemp((folder) => {
    const empty = openStore(folder);
    assert.throws(() => empty.resolve("latest"), /no runs in .* yet/);
    for (const offset of [0, 1000, 3600000]) save(folder, result([]), T0 + offset);
    const store = openStore(folder);
    const ids = store.runIds();
    assert.equal(ids.length, 3);
    assert.equal(store.resolve("latest"), ids[2]);
    assert.equal(store.resolve("latest~0"), ids[2]);
    assert.equal(store.resolve("latest~2"), ids[0]);
    assert.equal(store.resolve(ids[1]), ids[1]);
    assert.equal(store.resolve("20261101-10"), ids[2]);
    assert.throws(() => store.resolve("latest~3"), (error) => error instanceof StoreError && /holds 3 runs, so the oldest is latest~2/.test(error.message));
    assert.throws(() => store.resolve("20261101-09"), /is the start of 2 run ids/);
    assert.throws(() => store.resolve("2025"), /No run in .* has an id starting "2025"/);
    assert.throws(() => store.resolve(""), /No run/);
  });
});

test("two runs saved in the same millisecond get different ids, in the order they were saved", () => {
  inTemp((folder) => {
    const first = save(folder, result([]), T0);
    const second = save(folder, result([]), T0);
    assert.notEqual(first.id, second.id);
    assert.ok(first.id < second.id);
    assert.deepEqual(openStore(folder).entries().map((entry) => entry.id), [first.id, second.id]);
  });
});

test("the store may not be inside the site folder, and that is checked before anything is written", () => {
  withSite({ "index.html": page("<p>Hi</p>") }, (root) => {
    assert.throws(() => checkSaveTarget({ root, store: { path: join(root, ".builtcheck") } }), /inside the site folder/);
    assert.throws(() => checkSaveTarget({ root, store: { path: "." }, cwd: root }), /inside the site folder/);
    assert.ok(!existsSync(join(root, ".builtcheck")));
    inTemp((folder) => {
      assert.doesNotThrow(() => checkSaveTarget({ root, store: { path: join(folder, "store") } }));
    });
  });
});

test("an invalid config or label is refused before saving", () => {
  inTemp((folder) => {
    assert.throws(() => checkSaveTarget({ store: { path: folder }, config: { rules: { "links/nope": "off" } } }), ConfigError);
    assert.throws(() => save(folder, result([]), T0, { label: "two\nlines" }), /A label must be one line/);
    assert.throws(() => checkLabel("x".repeat(81)), StoreError);
    assert.equal(checkLabel("  release-2.4 "), "release-2.4");
    assert.equal(checkLabel(undefined), null);
    assert.ok(!existsSync(join(folder, "store.json")));
  });
});

test("the config digest follows the effective settings, not how they were written", () => {
  assert.equal(configDigest({}), configDigest({ rules: {} }));
  assert.equal(configDigest({}), configDigest({ rules: { "copy/em-dash": "warning" } }));
  assert.notEqual(configDigest({}), configDigest({ rules: { "copy/em-dash": "off" } }));
  assert.notEqual(configDigest({}), configDigest({}, { skip: ["copy/*"] }));
  assert.notEqual(configDigest({}), configDigest({ site: { url: "https://www.example.com" } }));
});

test("a store, run file or result from a newer builtcheck is refused with a message saying so", () => {
  inTemp((folder) => {
    writeFileSync(join(folder, "store.json"), JSON.stringify({ format: "builtcheck results store", storeVersion: STORE_VERSION + 1 }));
    assert.throws(() => openStore(folder), /store format 3, from a newer builtcheck. This version reads format 2 and older/);
  });
  inTemp((folder) => {
    const { id } = save(folder, result([]), T0);
    const file = join(folder, "runs", `${id}.json`);
    const record = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...record, storeVersion: STORE_VERSION + 1 }));
    assert.throws(() => openStore(folder).load(id), /saved by a newer builtcheck/);
    writeFileSync(file, JSON.stringify({ ...record, result: { ...record.result, resultVersion: RESULT_VERSION + 1 } }));
    assert.throws(() => openStore(folder).load(id), /newer builtcheck \(result version 2\)/);
  });
});

test("a folder that is neither a store nor a folder of reports is not used as one", () => {
  inTemp((folder) => {
    writeFileSync(join(folder, "notes.txt"), "x");
    writeFileSync(join(folder, "package.json"), "{}");
    assert.throws(() => openStore(folder), /is not a results store/);
    assert.throws(() => openStore(join(folder, "notes.txt")), /is a file, not a folder/);
    writeFileSync(join(folder, "store.json"), "{}");
    assert.throws(() => openStore(folder), /damaged: its store.json does not describe a builtcheck store/);
  });
});

test("a damaged run file is reported by name and does not hide the other runs", () => {
  inTemp((folder) => {
    const good = save(folder, result([]), T0);
    const bad = save(folder, result([]), T0 + 1000);
    writeFileSync(join(folder, "runs", `${bad.id}.json`), '{"storeVersion": 2, "meta": ');
    const store = openStore(folder);
    assert.throws(() => store.load(bad.id), (error) => error instanceof StoreError && error.message.includes(`Run ${bad.id} (runs/${bad.id}.json) is damaged: it is not valid JSON`));
    // The index still lists both, so listing works, and loading the good one works.
    assert.equal(store.entries().length, 2);
    assert.equal(store.load(good.id).meta.id, good.id);
    const report = store.verify();
    assert.equal(report.runs, 1);
    assert.equal(report.problems.length, 1);
    assert.equal(report.problems[0].run, bad.id);
    // Without the index, the damaged run is set aside and listed as unreadable.
    rmSync(join(folder, "index.json"));
    assert.deepEqual(store.entries().map((entry) => entry.id), [good.id]);
    assert.equal(store.unreadable[0].id, bad.id);
  });
});

test("listing trusts the run files over the index, and verify finds every disagreement", () => {
  inTemp((folder) => {
    const a = save(folder, result([]), T0);
    const b = save(folder, result([finding("copy/x", "a.html", 1)]), T0 + 1000);
    const c = save(folder, result([]), T0 + 2000);
    const indexPath = join(folder, "index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    // Lose b from the index, change c's count, and add an entry for a run that does not exist.
    const ghost = { ...index.runs[0], id: "20200101-000000-000" };
    writeFileSync(indexPath, JSON.stringify({ storeVersion: 2, runs: [ghost, index.runs[0], { ...index.runs[2], errors: 99 }] }));
    const store = openStore(folder);
    assert.deepEqual(store.entries().map((entry) => entry.id), [a.id, b.id, c.id]);
    assert.equal(store.entries()[1].errors, 1, "a run the index lacks is read from its file");
    const messages = store.verify().problems.map((problem) => problem.message);
    assert.deepEqual(messages.sort(), [
      `Run ${b.id} is not in the index.`,
      `The index entry for run ${c.id} does not match its run file.`,
      "The index lists run 20200101-000000-000, which has no run file.",
    ].sort());
    const rebuilt = store.verify({ rebuild: true });
    assert.equal(rebuilt.rebuilt, true);
    assert.equal(rebuilt.fixed, 3);
    assert.deepEqual(rebuilt.problems, []);
    assert.deepEqual(store.verify().problems, []);
    writeFileSync(indexPath, "not json");
    assert.match(store.verify().problems[0].message, /index.json is damaged/);
    rmSync(indexPath);
    assert.match(store.verify().problems[0].message, /index.json is missing/);
    assert.equal(store.entries().length, 3);
  });
});

test("removing runs deletes their files and their index entries", () => {
  inTemp((folder) => {
    const ids = [0, 1, 2].map((step) => save(folder, result([]), T0 + step * 1000).id);
    const store = openStore(folder);
    assert.equal(store.remove([ids[0], ids[1]]), 2);
    assert.deepEqual(readdirSync(join(folder, "runs")), [`${ids[2]}.json`]);
    assert.deepEqual(JSON.parse(readFileSync(join(folder, "index.json"), "utf8")).runs.map((entry) => entry.id), [ids[2]]);
    assert.deepEqual(store.verify().problems, []);
  });
});

test("a whole-file write leaves the old file as it was when it fails, and no temporary file", () => {
  inTemp((folder) => {
    const target = join(folder, "index.json");
    writeWhole(target, "first");
    writeWhole(target, "second");
    assert.equal(readFileSync(target, "utf8"), "second");
    assert.deepEqual(readdirSync(folder), ["index.json"]);
    writeFileSync(join(folder, "blocker"), "a file where a folder should be");
    assert.throws(() => writeWhole(join(folder, "blocker", "index.json"), "x"), (error) => error instanceof StoreError && /Cannot write/.test(error.message));
  });
});

test("a fresh lock makes a save wait and then give up with a plain message, and a stale lock is cleared", () => {
  inTemp((folder) => {
    writeFileSync(join(folder, LOCK_FILE), "{}");
    const started = Date.now();
    assert.throws(() => withLock(folder, () => 1, 150), /is busy: another builtcheck has held it .* delete .*lock/);
    assert.ok(Date.now() - started >= 140);
    const old = (Date.now() - 120000) / 1000;
    utimesSync(join(folder, LOCK_FILE), old, old);
    assert.equal(withLock(folder, () => "ran", 150), "ran");
    assert.ok(!existsSync(join(folder, LOCK_FILE)));
  });
});

test("runs saved by several processes at once all reach the index", async () => {
  await new Promise((resolveTest, rejectTest) => {
    const folder = mkdtempSync(join(tmpdir(), "builtcheck-store-"));
    const module = pathToFileURL(join(REPO_ROOT, "src", "store", "index.js")).href;
    const script = `
      import { saveRun } from ${JSON.stringify(module)};
      const result = { tool: "builtcheck", version: "1.0.0", resultVersion: 1, root: "dist", complete: true,
        summary: { errors: 0, warnings: 0, suppressed: 0, pages: 1, stylesheets: 0, files: 1 }, findings: [], skipped: [] };
      for (let i = 0; i < 5; i += 1) saveRun(result, { store: { path: process.argv[1] }, folder: "dist", now: ${T0} });
    `;
    const workers = Array.from({ length: 6 }, () => spawn(process.execPath, ["--input-type=module", "-e", script, folder], { stdio: ["ignore", "ignore", "pipe"] }));
    let errors = "";
    let finished = 0;
    for (const worker of workers) {
      worker.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      worker.on("close", (code) => {
        finished += 1;
        if (code !== 0) errors += `worker exited ${code}\n`;
        if (finished < workers.length) return;
        try {
          assert.equal(errors, "");
          const index = JSON.parse(readFileSync(join(folder, "index.json"), "utf8"));
          assert.equal(index.runs.length, 30);
          assert.equal(new Set(index.runs.map((entry) => entry.id)).size, 30);
          assert.deepEqual(openStore(folder).verify().problems, []);
          resolveTest();
        } catch (error) {
          rejectTest(error);
        } finally {
          rmSync(folder, { recursive: true, force: true });
        }
      });
    }
  });
});

// A folder of JSON reports as people keep them today, with file times in a known order.
function reportFolder(folder) {
  const reports = {
    "2026-11-01.json": result([finding("links/broken-internal", "index.html", 3), finding("copy/placeholder-text", "about.html", 9)]),
    "2026-11-02.json": result([finding("links/broken-internal", "index.html", 5)]),
    // From before results had a version, "complete" or "skipped".
    "first.json": (({ resultVersion, complete, skipped, ...rest }) => rest)(result([finding("schema/missing-context", "index.html", 1)])),
  };
  const times = { "first.json": T0, "2026-11-01.json": T0 + 86400000, "2026-11-02.json": T0 + 2 * 86400000 };
  for (const [name, value] of Object.entries(reports)) {
    writeFileSync(join(folder, name), JSON.stringify(value, null, 2));
    utimesSync(join(folder, name), times[name] / 1000, times[name] / 1000);
  }
  writeFileSync(join(folder, "package.json"), '{"name": "example"}');
  writeFileSync(join(folder, "broken.json"), "{ not json");
  writeFileSync(join(folder, "report.html"), "<p>an HTML report</p>");
}

test("a folder of JSON reports reads as store format 1 without converting it", () => {
  inTemp((folder) => {
    reportFolder(folder);
    const store = openStore(folder);
    assert.equal(store.version, 1);
    const entries = store.entries();
    assert.deepEqual(entries.map((entry) => entry.id), [idFor(T0), idFor(T0 + 86400000), idFor(T0 + 2 * 86400000)]);
    assert.deepEqual(entries.map((entry) => entry.errors), [1, 2, 1]);
    assert.equal(entries[0].source, "report file");
    const { result: upgraded, meta } = store.load(entries[0].id);
    assert.equal(meta.file, "first.json");
    assert.equal(upgraded.resultVersion, RESULT_VERSION);
    assert.equal(upgraded.complete, true);
    assert.deepEqual(upgraded.skipped, []);
    assert.equal(store.resolve("latest"), entries[2].id);
    // Writing asks for the conversion first.
    assert.throws(() => save(folder, result([]), T0), /folder of JSON reports.*builtcheck store migrate/);
    assert.throws(() => store.remove([entries[0].id]), /store migrate/);
    const report = store.verify();
    assert.equal(report.runs, 3);
    assert.deepEqual(report.problems.map((problem) => problem.message), ["broken.json: not valid JSON"]);
  });
});

test("migration converts a folder of reports in place, keeps every run and its id, and moves the originals aside", () => {
  inTemp((folder) => {
    reportFolder(folder);
    const before = openStore(folder).entries();
    const outcome = migrateStore(openStore(folder));
    assert.equal(outcome.from, 1);
    assert.equal(outcome.to, STORE_VERSION);
    assert.equal(outcome.changed, true);
    const [step] = outcome.steps;
    assert.deepEqual(step.runs.map((run) => run.file), ["first.json", "2026-11-01.json", "2026-11-02.json"]);
    assert.deepEqual(step.left.map((entry) => entry.file).sort(), ["broken.json", "package.json"]);
    assert.equal(step.originals, "reports-before-migration");
    assert.deepEqual(readdirSync(join(folder, "reports-before-migration")).sort(), ["2026-11-01.json", "2026-11-02.json", "first.json"]);
    // Files that were not runs stay where they were; nothing of the staging is left.
    for (const name of ["package.json", "broken.json", "report.html"]) assert.ok(existsSync(join(folder, name)), name);
    assert.ok(!existsSync(join(folder, ".migrating")));
    const store = openStore(folder);
    assert.equal(store.version, STORE_VERSION);
    const after = store.entries();
    assert.deepEqual(after.map((entry) => [entry.id, entry.errors, entry.ranAt]), before.map((entry) => [entry.id, entry.errors, entry.ranAt]));
    assert.deepEqual(store.verify().problems, []);
    assert.doesNotThrow(() => save(folder, result([]), T0 + 3 * 86400000));
    assert.equal(migrateStore(openStore(folder)).changed, false);
  });
});

test("an interrupted migration is cleared up and run again", () => {
  inTemp((folder) => {
    reportFolder(folder);
    // As if killed after moving runs/ and index.json into place, but before store.json.
    mkdirSync(join(folder, ".migrating"));
    writeFileSync(join(folder, ".migrating", "store.json"), "{}");
    mkdirSync(join(folder, "runs"));
    writeFileSync(join(folder, "runs", "20200101-000000-000.json"), "{}");
    writeFileSync(join(folder, "index.json"), "{}");
    assert.equal(openStore(folder).version, 1);
    migrateStore(openStore(folder));
    const store = openStore(folder);
    assert.equal(store.runIds().length, 3);
    assert.deepEqual(store.verify().problems, []);
  });
});

test("migration will not take over a runs folder it did not write", () => {
  inTemp((folder) => {
    reportFolder(folder);
    mkdirSync(join(folder, "runs"));
    assert.throws(() => migrateStore(openStore(folder)), /already has a runs folder or an index.json that builtcheck did not write/);
    assert.ok(existsSync(join(folder, "first.json")));
    assert.throws(() => migrateStore(openStore(join(folder, "missing"))), /There is no results store or folder of reports/);
  });
});

test("upgrading fills what older results lack and refuses what is not a result", () => {
  const old = { tool: "builtcheck", version: "0.9.0", root: "dist", summary: { errors: 1, warnings: 0, pages: 2 }, findings: [{ rule: "links/x", severity: "error", message: "m", file: "a.html" }] };
  const upgraded = upgradeResult(old, "old.json");
  assert.equal(upgraded.resultVersion, RESULT_VERSION);
  assert.equal(upgraded.complete, true);
  assert.deepEqual(upgraded.skipped, []);
  assert.equal(upgraded.summary.suppressed, 0);
  assert.equal(upgraded.findings[0].line, null);
  assert.equal(upgradeResult({ ...old, summary: { pages: 0 } }, "x").complete, false);
  assert.equal(upgradeResult({ ...old, summary: {} }, "x").summary.errors, 1, "counts come from the findings when missing");
  assert.throws(() => upgradeResult({ hello: 1 }, "notes.json"), /notes.json is not a builtcheck JSON report/);
  assert.throws(() => upgradeResult({ ...old, findings: [{ rule: 1 }] }, "bad.json"), /bad.json is damaged: finding 1/);
  assert.throws(() => upgradeResult({ ...old, resultVersion: "one" }, "bad.json"), /not a version number/);
  // The real thing comes through unchanged.
  withSite({ "index.html": page('<a href="/missing/">x</a>') }, (root) => {
    const real = audit(root);
    assert.deepEqual(upgradeResult(JSON.parse(JSON.stringify(real)), "real"), JSON.parse(JSON.stringify(real)));
  });
});

test("comparing matches findings by rule, file and message, so moved lines are still present", () => {
  const before = result([
    finding("links/broken-internal", "index.html", 10, "Link /a/ is broken"),
    finding("links/broken-internal", "index.html", 20, "Link /b/ is broken"),
    finding("copy/placeholder-text", "about.html", 5, "Lorem", "warning"),
    finding("copy/placeholder-text", "about.html", 9, "Lorem", "warning"),
  ]);
  const after = result([
    finding("links/broken-internal", "index.html", 14, "Link /a/ is broken"),
    finding("links/missing-anchor", "index.html", 3, "Anchor #x is missing"),
    finding("copy/placeholder-text", "about.html", 9, "Lorem", "error"),
  ]);
  const changes = compareResults(upgradeResult(before, "a"), upgradeResult(after, "b"));
  assert.deepEqual(changes.added.map((entry) => entry.message), ["Anchor #x is missing"]);
  assert.deepEqual(changes.gone.map((entry) => [entry.message, entry.line]), [["Lorem", 5], ["Link /b/ is broken", 20]]);
  assert.deepEqual(changes.still.map((entry) => [entry.message, entry.line, entry.previous.line]), [["Lorem", 9, 9], ["Link /a/ is broken", 14, 10]]);
  assert.equal(changes.summary.severityChanged, 1);
  assert.deepEqual(changes.summary.before, { errors: 2, warnings: 2, pages: 2, complete: true });
  assert.deepEqual(changes.rules, [
    { rule: "copy/placeholder-text", before: 2, after: 1, added: 0, gone: 1 },
    { rule: "links/broken-internal", before: 2, after: 1, added: 0, gone: 1 },
    { rule: "links/missing-anchor", before: 0, after: 1, added: 1, gone: 0 },
  ]);
  const same = compareResults(upgradeResult(before, "a"), upgradeResult(before, "a"));
  assert.deepEqual([same.summary.added, same.summary.gone, same.summary.still, same.rules.length], [0, 0, 4, 0]);
});

function gitTree(folder, files) {
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(folder, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(folder, ...path.split("/")), contents);
  }
}

test("the git branch and commit are read from the files under .git", () => {
  const hash = "3f2c9a7d41b0e8c6f5a2d9b1e7c4a8f0d3b6e2a1";
  inTemp((folder) => {
    gitTree(folder, { ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": `${hash}\n`, "site/src/x.txt": "x" });
    assert.deepEqual(gitState(join(folder, "site", "src")), { branch: "main", commit: hash });
    writeFileSync(join(folder, ".git", "HEAD"), "ref: refs/heads/feature/new-menu\n");
    writeFileSync(join(folder, ".git", "packed-refs"), `# pack-refs with: peeled\n${hash} refs/heads/feature/new-menu\n`);
    assert.deepEqual(gitState(folder), { branch: "feature/new-menu", commit: hash });
    writeFileSync(join(folder, ".git", "HEAD"), "ref: refs/heads/unborn\n");
    assert.deepEqual(gitState(folder), { branch: "unborn", commit: null });
    writeFileSync(join(folder, ".git", "HEAD"), `${hash}\n`);
    assert.deepEqual(gitState(folder), { branch: null, commit: hash });
    writeFileSync(join(folder, ".git", "HEAD"), "ref: refs/heads/../../escape\n");
    assert.equal(gitState(folder).commit, null);
    writeFileSync(join(folder, ".git", "HEAD"), "garbage");
    assert.equal(gitState(folder), null);
  });
  // A worktree: .git is a file naming its folder, which shares branches through commondir.
  inTemp((folder) => {
    gitTree(folder, {
      "main/.git/refs/heads/topic": `${hash}\n`,
      "main/.git/worktrees/wt/HEAD": "ref: refs/heads/topic\n",
      "main/.git/worktrees/wt/commondir": "../..\n",
      "wt/.git": `gitdir: ${join(folder, "main", ".git", "worktrees", "wt")}\n`,
    });
    assert.deepEqual(gitState(join(folder, "wt")), { branch: "topic", commit: hash });
  });
});

test("a run saved inside a git repository records its branch and commit", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  inTemp((folder) => {
    gitTree(folder, { ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": hash });
    const saved = saveRun(result([]), { store: { path: "store" }, cwd: folder, now: T0 });
    assert.deepEqual(saved.entry.git, { branch: "main", commit: hash });
    assert.ok(existsSync(join(folder, "store", "runs", `${saved.id}.json`)), "a relative store path is relative to the current folder");
  });
});

test("the store and its commands start no process and reach no network", () => {
  for (const folder of ["store", "commands"]) {
    for (const name of readdirSync(join(REPO_ROOT, "src", folder))) {
      const source = readFileSync(join(REPO_ROOT, "src", folder, name), "utf8");
      assert.doesNotMatch(source, /node:(child_process|net|http|https|dgram|worker_threads)/, `${folder}/${name}`);
    }
  }
});
