// builtcheck store: look after the results store itself.

import { join } from "node:path";
import { UsageError } from "../cli.js";
import { printable } from "../report/printable.js";
import { migrateStore, openStore, STORE_VERSION } from "../store/index.js";
import { bytes, json, localTime, outputFormat, plural, readOptions, storeFrom, wholeNumber } from "../store/command-line.js";

export const summary = "Look after the results store: info, verify, prune or migrate";

export const usage = `builtcheck store: look after the results store.

Usage:
  builtcheck store info                      Its format, how many runs it holds, and its size
  builtcheck store verify [--rebuild-index]  Check every run file and the index
  builtcheck store prune --keep <n>          Remove all but the newest n runs
  builtcheck store prune --older-than <days> Remove runs older than that many days
  builtcheck store migrate [<folder>]        Convert an older store, or a folder of JSON
                                             reports, to the current format

Options:
  --rebuild-index    With verify: write the index again from the run files
  --keep <n>         With prune: keep the newest n runs
  --older-than <d>   With prune: remove runs that ran more than d days ago. With --keep as
                     well, a run is removed when either says so
  --dry-run          With prune: list what would be removed, and remove nothing
  --format <name>    text or json. Text is the default
  --store <folder>   The results store folder (default: .builtcheck in the current folder)
  --config <file>    Config file to read "store.path" from
  --no-config        Ignore any config file
  --help, -h         Print this help

Exit codes: 0 when it did what was asked; for verify, 1 when it found problems; 2 when it could
not run.
`;

const DAY_MS = 24 * 60 * 60 * 1000;

function formatName(version) {
  if (version === 1) return "1, a folder of JSON reports from before the store had a format";
  return version === STORE_VERSION ? `${version}, the current format` : `${version}`;
}

function info(store, format, io) {
  const entries = store.version === 0 ? [] : store.entries();
  const details = {
    store: store.shown,
    exists: store.version !== 0,
    storeVersion: store.version || null,
    current: store.version === STORE_VERSION,
    runs: entries.length,
    unreadable: store.unreadable.length,
    bytes: store.size(),
    oldest: entries[0] ?? null,
    newest: entries[entries.length - 1] ?? null,
  };
  if (format === "json") {
    io.stdout(json(details));
    return 0;
  }
  if (!details.exists) {
    io.stdout(`There is no results store at ${printable(store.shown)} yet. Saving a run with --save creates it.\n`);
    return 0;
  }
  const lines = [`Results store ${printable(store.shown)}`, `  Format      ${formatName(store.version)}`, `  Runs        ${details.runs}`];
  if (details.unreadable > 0) lines.push(`  Unreadable  ${plural(details.unreadable, "run")}: builtcheck store verify says why`);
  lines.push(`  Size        ${bytes(details.bytes)}`);
  if (details.oldest) lines.push(`  Oldest run  ${details.oldest.id}, ${localTime(details.oldest.ranAt)}`, `  Newest run  ${details.newest.id}, ${localTime(details.newest.ranAt)}`);
  if (store.version === 1) lines.push("", `To save new runs here, convert it with: builtcheck store migrate ${printable(store.shown)}`);
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

function verify(store, options, format, io) {
  const report = store.verify({ rebuild: Boolean(options["rebuild-index"]) });
  if (format === "json") {
    io.stdout(json({ store: store.shown, ...report }));
    return report.problems.length > 0 ? 1 : 0;
  }
  const lines = [`Checked ${plural(report.runs + report.problems.filter((problem) => problem.run && !problem.index).length, "run")} in ${printable(store.shown)}.`];
  for (const problem of report.problems) lines.push(`  ${printable(problem.message)}`);
  if (report.rebuilt) lines.push(`Rebuilt the index from ${plural(report.runs, "readable run")}${report.fixed > 0 ? `, which fixed ${plural(report.fixed, "problem")} with it` : ""}.`);
  if (report.problems.length === 0) {
    lines.push("No problems found.");
  } else {
    lines.push(`${plural(report.problems.length, "problem")} found.`);
    if (report.problems.some((problem) => problem.index)) lines.push("To write the index again from the run files, run: builtcheck store verify --rebuild-index");
    if (report.problems.some((problem) => !problem.index)) lines.push("A damaged run file can be restored from a backup or deleted; the other runs do not depend on it.");
  }
  io.stdout(`${lines.join("\n")}\n`);
  return report.problems.length > 0 ? 1 : 0;
}

// The time a run ran, from its id, which works for a run whose file is damaged too.
function timeOfId(id) {
  const [, year, month, day, hours, minutes, seconds, ms] = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{3})$/.exec(id).map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes, seconds, ms);
}

function prune(store, options, format, io) {
  const keep = wholeNumber(options.keep, "--keep");
  const days = wholeNumber(options["older-than"], "--older-than");
  if (keep === null && days === null) throw new UsageError("Say what to remove with --keep <n>, --older-than <days>, or both. Add --dry-run to see what that would remove first.");
  store.requireWritable();
  const ids = store.runIds();
  const cutoff = days === null ? null : Date.now() - days * DAY_MS;
  const doomed = ids.filter((id, index) => (keep !== null && index < ids.length - keep) || (cutoff !== null && timeOfId(id) < cutoff));
  const dryRun = Boolean(options["dry-run"]);
  if (!dryRun && doomed.length > 0) store.remove(doomed);
  if (format === "json") {
    io.stdout(json({ store: store.shown, dryRun, removed: doomed, kept: ids.length - doomed.length }));
    return 0;
  }
  if (doomed.length === 0) {
    io.stdout(`Nothing to remove: ${printable(store.shown)} holds ${plural(ids.length, "run")}, and each is within the limits given.\n`);
    return 0;
  }
  const verb = dryRun ? "Would remove" : "Removed";
  io.stdout(`${verb} ${plural(doomed.length, "run")} from ${printable(store.shown)}, keeping ${ids.length - doomed.length}:\n${doomed.map((id) => `  ${id}`).join("\n")}\n`);
  return 0;
}

function migrate(store, format, io) {
  const outcome = migrateStore(store);
  if (format === "json") {
    io.stdout(json({ store: store.shown, ...outcome }));
    return 0;
  }
  if (!outcome.changed) {
    io.stdout(`${printable(store.shown)} is already in store format ${STORE_VERSION}, the current one. Nothing to do.\n`);
    return 0;
  }
  const lines = [`Converted ${printable(store.shown)} from store format ${outcome.from} to ${outcome.to}.`];
  for (const step of outcome.steps) {
    for (const { file, id } of step.runs ?? []) lines.push(`  ${printable(file)} is now run ${id}`);
    if (step.left?.length > 0) {
      lines.push("Left where they were, since they are not runs it could read:");
      for (const { file, reason } of step.left) lines.push(`  ${printable(file)}: ${printable(reason)}`);
    }
    if (step.originals) {
      lines.push(`The original reports are now in ${printable(join(store.shown, step.originals))}. Nothing reads them any more, so delete that folder when you no longer need them.`);
    }
  }
  io.stdout(`${lines.join("\n")}\n`);
  return 0;
}

const ACTIONS = ["info", "verify", "prune", "migrate"];

export function run(argv, io) {
  const options = readOptions("store", argv, { values: ["keep", "older-than"], booleans: ["rebuild-index", "dry-run"] });
  const [action, ...rest] = options.positional;
  if (options.help) {
    io.stdout(usage);
    return 0;
  }
  if (action === undefined) throw new UsageError("Give a store command: info, verify, prune or migrate. See builtcheck store --help.");

  if (!ACTIONS.includes(action)) throw new UsageError(`builtcheck store ${action} is not a store command. Use info, verify, prune or migrate.`);
  const allowed = { "rebuild-index": "verify", keep: "prune", "older-than": "prune", "dry-run": "prune" };
  for (const [option, owner] of Object.entries(allowed)) {
    if (options[option] !== undefined && action !== owner) throw new UsageError(`--${option} belongs to builtcheck store ${owner}, not ${action}`);
  }
  if (rest.length > (action === "migrate" ? 1 : 0)) throw new UsageError(`builtcheck store ${action} takes ${action === "migrate" ? "at most one folder" : "no folder"}. Name the store with --store.`);
  const format = outputFormat(options);
  const store = action === "migrate" && rest.length === 1 ? openStore(rest[0]) : storeFrom(options);
  if (action === "info") return info(store, format, io);
  if (action === "verify") return verify(store, options, format, io);
  if (action === "prune") return prune(store, options, format, io);
  return migrate(store, format, io);
}
