// builtcheck show: a saved run as a report, in any of the report formats.

import { resolve } from "node:path";
import { isSameOrInside, reachedPath, render, UsageError, writeReport } from "../cli.js";
import { FORMAT_NAMES, formatList } from "../report/index.js";
import { printable } from "../report/printable.js";
import { localTime, readOptions, runName, storeFrom } from "../store/command-line.js";

export const summary = "Show a saved run as a report, in any report format";

export const usage = `builtcheck show: show a saved run as a report.

Usage:
  builtcheck show <run> [options]

<run> is a run id, the start of one, latest, or latest~N for the run N before the latest.

Options:
  --format <name>    ${formatList()}. Text is the default
  --output <file>    Write the report to a file instead of stdout
  --quiet            In text output, list errors only
  --all              In text output, list every finding with nothing collapsed
  --no-color         Plain text output
  --store <folder>   The results store folder (default: .builtcheck in the current folder)
  --config <file>    Config file to read "store.path" from
  --no-config        Ignore any config file
  --help, -h         Print this help
`;

// What a text report of a saved run says first, since the report itself does not say when it ran.
export function describeRun(meta) {
  const git = meta.git ? `, ${meta.git.branch ? `branch ${meta.git.branch}` : "detached HEAD"}${meta.git.commit ? ` at ${meta.git.commit.slice(0, 12)}` : ""}` : "";
  const folder = meta.folder ? ` of ${meta.folder}` : "";
  return printable(`Run ${meta.label ? `${meta.id} (${meta.label})` : meta.id}${folder}, audited ${localTime(meta.ranAt)} by builtcheck ${meta.toolVersion ?? "of an unknown version"}${git}`);
}

export function run(argv, io) {
  const options = readOptions("show", argv, { values: ["output"], booleans: ["quiet", "all", "no-color"] });
  if (options.help) {
    io.stdout(usage);
    return 0;
  }
  if (options.positional.length !== 1) {
    throw new UsageError(options.positional.length === 0 ? "Give the run to show, such as: builtcheck show latest" : "Give one run to show. To see what changed between two, use builtcheck compare.");
  }
  const format = options.format ?? "text";
  if (!FORMAT_NAMES.includes(format)) throw new UsageError(`--format must be ${formatList()}, not "${format}"`);
  const store = storeFrom(options);
  const id = store.resolve(options.positional[0]);
  const { meta, result } = store.load(id);
  if (options.output) {
    const target = resolve(options.output);
    if (isSameOrInside(store.path, target) || isSameOrInside(reachedPath(store.path), reachedPath(target))) {
      throw new UsageError(`--output ${options.output} is inside the results store. Write the report somewhere else.`);
    }
  }
  const report = render(result, format, options, io);
  const shown = format === "text" ? `${describeRun(meta)}\n\n${report}` : report;
  if (options.output) {
    // The run's folder, as far as it can be found from here, so a report is not written into the site.
    writeReport(options.output, shown, resolve(meta.folder ?? store.path));
    io.stdout(`Run ${runName(meta)} written to ${printable(options.output)}\n`);
  } else {
    io.stdout(shown);
  }
  return 0;
}
