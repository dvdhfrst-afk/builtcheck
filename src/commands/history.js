// builtcheck history: the saved runs, newest first.

import { UsageError } from "../cli.js";
import { printable } from "../report/printable.js";
import { json, localTime, outputFormat, plural, readOptions, storeFrom, table, wholeNumber } from "../store/command-line.js";

export const summary = "List the saved runs, newest first";

export const usage = `builtcheck history: list the runs saved in the results store, newest first.

Usage:
  builtcheck history [options]

Options:
  --limit <n>        Show only the newest n runs
  --format <name>    text or json. Text is the default
  --store <folder>   The results store folder (default: .builtcheck in the current folder)
  --config <file>    Config file to read "store.path" from
  --no-config        Ignore any config file
  --help, -h         Print this help

Other commands name a run by its id, the start of its id, latest, or latest~N for the run N
before the latest.
`;

const TREND_RUNS = 12;

// The error counts of the newest runs shown, oldest first, and where they went overall.
export function trendLine(newestFirst) {
  const counts = newestFirst.slice(0, TREND_RUNS).map((entry) => entry.errors).reverse();
  if (counts.length < 2) return null;
  const change = counts[counts.length - 1] - counts[0];
  const direction = change === 0 ? "no change" : change < 0 ? `down ${-change}` : `up ${change}`;
  return `Errors, oldest to newest: ${counts.join(", ")} (${direction})`;
}

const LABEL_WIDTH = 24;

function shorten(text, width) {
  return text.length > width ? `${text.slice(0, width - 3)}...` : text;
}

function textReport(store, shown, total) {
  if (total === 0) {
    return `No runs saved in ${printable(store.shown)} yet. Save one with: builtcheck <folder> --save\n`;
  }
  const rows = [["ID", "DATE", "ERRORS", "WARNINGS", "PAGES", "STATUS", "LABEL", "FOLDER"]];
  for (const entry of shown) {
    rows.push([
      entry.id,
      localTime(entry.ranAt),
      entry.errors,
      entry.warnings,
      entry.pages,
      entry.complete ? "complete" : "incomplete",
      shorten(printable(entry.label ?? ""), LABEL_WIDTH),
      printable(entry.folder ?? ""),
    ]);
  }
  const heading = shown.length === total ? `${plural(total, "run")} in ${printable(store.shown)}, newest first` : `The newest ${shown.length} of ${total} runs in ${printable(store.shown)}`;
  const trend = trendLine(shown);
  return `${heading}\n\n${table(rows, [2, 3, 4])}\n${trend ? `\n${trend}\n` : ""}`;
}

export function run(argv, io) {
  const options = readOptions("history", argv, { values: ["limit"] });
  if (options.help) {
    io.stdout(usage);
    return 0;
  }
  if (options.positional.length > 0) throw new UsageError(`builtcheck history takes no folder or run, only options. See builtcheck history --help.`);
  const format = outputFormat(options);
  const limit = wholeNumber(options.limit, "--limit");
  if (limit === 0) throw new UsageError("--limit needs a number above 0");
  const store = storeFrom(options);
  const newestFirst = store.entries().reverse();
  const shown = limit === null ? newestFirst : newestFirst.slice(0, limit);
  for (const { reason } of store.unreadable) io.stderr(`builtcheck: ${printable(reason)}\n`);
  if (store.unreadable.length > 0) io.stderr("builtcheck: builtcheck store verify checks every run in the store.\n");
  if (store.version === 1) io.stderr(`builtcheck: ${printable(store.shown)} is a folder of JSON reports, which reads as it is. To save new runs in it, convert it with: builtcheck store migrate ${printable(store.shown)}\n`);
  if (format === "json") {
    io.stdout(json({ store: store.shown, storeVersion: store.version || null, total: newestFirst.length, runs: shown }));
  } else {
    io.stdout(textReport(store, shown, newestFirst.length));
  }
  return 0;
}
