// builtcheck compare: what changed between two saved runs. It only reports, so it exits 0 whatever
// changed, and 2 when it could not compare.

import { UsageError } from "../cli.js";
import { printable } from "../report/printable.js";
import { compareResults } from "../store/index.js";
import { json, outputFormat, plural, readOptions, runName, storeFrom, table } from "../store/command-line.js";
import { entryFor } from "../store/store.js";

export const summary = "Show what changed between two saved runs";

export const usage = `builtcheck compare: show what changed between two saved runs.

Usage:
  builtcheck compare [<earlier run> [<later run>]] [options]

A run is a run id, the start of one, latest, or latest~N for the run N before the latest. With
no runs given it compares latest~1 with latest, and with one it compares that run with latest.

Findings are the same in both runs when their rule, file and message match, so a finding whose
line moved is still present, not gone and new.

Options:
  --all              List every finding, including those still present, with none left out
  --format <name>    text or json. Text is the default
  --store <folder>   The results store folder (default: .builtcheck in the current folder)
  --config <file>    Config file to read "store.path" from
  --no-config        Ignore any config file
  --help, -h         Print this help

Exit codes: 0 when it compared the runs, whatever changed; 2 when it could not.
`;

const LIST_LIMIT = 25;

// What could make the two runs differ besides the site, so a change is not misread.
export function notesFor(before, after) {
  const notes = [];
  if (before.ranAt > after.ranAt) notes.push(`Run ${before.id} is newer than run ${after.id}, so "new" and "gone" run backwards in time.`);
  if (before.folder !== after.folder) notes.push(`The runs audited different folders: ${before.folder ?? "unknown"} and ${after.folder ?? "unknown"}.`);
  if (before.toolVersion !== after.toolVersion) {
    notes.push(`The runs were made by different builtcheck versions (${before.toolVersion ?? "unknown"} and ${after.toolVersion ?? "unknown"}), whose rules may differ.`);
  }
  if (before.configDigest && after.configDigest && before.configDigest !== after.configDigest) {
    notes.push("The runs used different settings (rules, their options or site settings), so some changes may come from the settings and not the site.");
  }
  for (const entry of [before, after]) {
    if (!entry.complete) notes.push(`Run ${entry.id} is incomplete: some files could not be read or a rule failed, so its findings are not the whole story.`);
  }
  return notes;
}

function signed(change) {
  return change === 0 ? "" : change > 0 ? `+${change}` : `${change}`;
}

function findingLine(finding) {
  const at = finding.line === null ? "" : finding.column === null ? `:${finding.line}` : `:${finding.line}:${finding.column}`;
  const severity = finding.severity === "error" ? "error  " : "warning";
  return printable(`  ${finding.file}${at}  ${severity}  ${finding.message}  ${finding.rule}`);
}

function section(title, findings, showAll) {
  if (findings.length === 0) return [];
  const listed = showAll ? findings : findings.slice(0, LIST_LIMIT);
  const lines = ["", title, ...listed.map(findingLine)];
  if (listed.length < findings.length) lines.push(`  ... and ${findings.length - listed.length} more (use --all to list them)`);
  return lines;
}


function textReport(before, after, changes, notes, showAll) {
  const { summary: counts } = changes;
  const lines = [`Comparing run ${runName(before)} with run ${runName(after)}`, ""];
  const row = (name, key) => [name, counts.before[key], counts.after[key], signed(counts.after[key] - counts.before[key])];
  lines.push(table([["", "BEFORE", "AFTER", "CHANGE"], row("Errors", "errors"), row("Warnings", "warnings"), row("Pages", "pages")], [1, 2, 3]).replace(/^/gm, "  "));
  const severity = counts.severityChanged > 0 ? `, ${counts.severityChanged} of them with a different severity` : "";
  lines.push("", `${counts.added} new, ${counts.gone} gone, ${counts.still} still present${severity}.`);
  lines.push(...section(`New in ${after.id}`, changes.added, showAll));
  lines.push(...section(`Gone since ${before.id}`, changes.gone, showAll));
  if (showAll) lines.push(...section("Still present", changes.still, true));
  if (changes.rules.length > 0) {
    lines.push("", "Changes by rule");
    const rows = changes.rules.map((entry) => [entry.rule, `${entry.before} -> ${entry.after}`, [entry.added > 0 ? `${entry.added} new` : "", entry.gone > 0 ? `${entry.gone} gone` : ""].filter(Boolean).join(", ")]);
    lines.push(table(rows).replace(/^/gm, "  "));
  }
  if (notes.length > 0) lines.push("", "Notes", ...notes.map((note) => printable(`  ${note}`)));
  return `${lines.join("\n")}\n`;
}

export function run(argv, io) {
  const options = readOptions("compare", argv, { booleans: ["all"] });
  if (options.help) {
    io.stdout(usage);
    return 0;
  }
  if (options.positional.length > 2) throw new UsageError("Give at most two runs to compare: the earlier one, then the later one.");
  const format = outputFormat(options);
  const store = storeFrom(options);
  const [first, second] = options.positional.length === 0 ? ["latest~1", "latest"] : [options.positional[0], options.positional[1] ?? "latest"];

  if (store.runIds().length < 2 && options.positional.length < 2) {
    throw new UsageError(`Comparing needs two runs, and ${printable(store.shown)} holds ${plural(store.runIds().length, "run")}. Save another with: builtcheck <folder> --save`);
  }
  const ids = [store.resolve(first), store.resolve(second)];
  const [older, newer] = ids.map((id) => store.load(id));
  const before = entryFor(older.meta, older.result);
  const after = entryFor(newer.meta, newer.result);
  const changes = compareResults(older.result, newer.result);
  const notes = notesFor(before, after);
  if (ids[0] === ids[1]) notes.unshift("Both names lead to the same run, so nothing can have changed.");
  if (format === "json") io.stdout(json({ before, after, notes, ...changes }));
  else io.stdout(textReport(before, after, changes, notes, Boolean(options.all)));
  return 0;
}
