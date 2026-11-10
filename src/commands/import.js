// builtcheck import: adds JSON reports written with --format json --output to the results store,
// as runs from the time each file was written.

import { statSync } from "node:fs";
import { basename } from "node:path";
import { plainError, UsageError } from "../cli.js";
import { printable } from "../report/printable.js";
import { checkLabel, StoreError, upgradeResult } from "../store/index.js";
import { json, outputFormat, plural, readOptions, storeFrom } from "../store/command-line.js";
import { readJson } from "../store/files.js";
import { digestOf } from "../store/store.js";

export const summary = "Add JSON reports to the results store as runs";

export const usage = `builtcheck import: add JSON reports to the results store as saved runs.

Usage:
  builtcheck import <report.json> [<report.json> ...] [options]

A report is what builtcheck writes with --format json. Each becomes a run dated from the time
its file was last written, since a report does not record when it ran. A report already in the
store is not added twice.

Options:
  --label <text>     Name the runs added, such as release-2.4
  --format <name>    text or json. Text is the default
  --store <folder>   The results store folder (default: .builtcheck in the current folder)
  --config <file>    Config file to read "store.path" from
  --no-config        Ignore any config file
  --help, -h         Print this help
`;

function readReport(path) {
  let stat;
  try {
    stat = statSync(path);
  } catch (error) {
    throw new StoreError(`Cannot read ${path}: ${plainError(error)}`);
  }
  if (!stat.isFile()) throw new StoreError(`${path} is not a file. Give a JSON report written with --format json.`);
  const value = readJson(path, path);
  upgradeResult(value, path);
  return { path, value, ranAt: new Date(stat.mtimeMs).toISOString() };
}

export function run(argv, io) {
  const options = readOptions("import", argv, { values: ["label"] });
  if (options.help) {
    io.stdout(usage);
    return 0;
  }
  if (options.positional.length === 0) throw new UsageError("Give the JSON report to import, such as: builtcheck import report.json");
  const format = outputFormat(options);
  const label = checkLabel(options.label);
  const store = storeFrom(options);
  // Every file is read and checked first, so one bad file adds nothing.
  const reports = options.positional.map(readReport);
  store.requireWritable();
  const known = new Map(store.entries().map((entry) => [entry.resultDigest, entry.id]));
  const fresh = [];
  const already = [];
  for (const report of reports) {
    const digest = digestOf(report.value);
    if (known.has(digest)) {
      already.push({ file: report.path, id: known.get(digest) });
      continue;
    }
    known.set(digest, null);
    fresh.push(report);
  }
  const added = fresh.length === 0 ? [] : store.addAll(fresh.map((report) => ({
    result: report.value,
    details: { ranAt: report.ranAt, label, folder: typeof report.value.root === "string" ? report.value.root : null, source: "import", file: basename(report.path) },
  })));
  const imported = added.map((entry, index) => ({ file: fresh[index].path, id: entry.id }));
  if (format === "json") {
    io.stdout(json({ store: store.shown, added: imported, skipped: already }));
    return 0;
  }
  const lines = imported.map(({ file, id }) => `Added ${printable(file)} as run ${id}`);
  for (const { file, id } of already) {
    lines.push(id ? `Left out ${printable(file)}: it is already in the store as run ${id}` : `Left out ${printable(file)}: it is the same report as one given before it`);
  }
  lines.push(`${plural(imported.length, "run")} added to ${printable(store.shown)}.`);
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}
