// Commands other than auditing a folder. `builtcheck <command> ...` runs one; a folder whose name
// is the same as a command can still be audited by writing it as ./name.
//
// A command module exports `summary` (one line for --help), `usage` (its own help text) and
// `run(argv, io)`, which returns an exit code or a promise of one. `io` is the same object
// main() receives.
//
// The modules are listed whole rather than by their fields, because they import src/cli.js,
// which imports this file: their fields are read only once a command runs.

import * as compare from "./compare.js";
import * as history from "./history.js";
import * as importReports from "./import.js";
import * as show from "./show.js";
import * as store from "./store.js";

export const COMMANDS = { history, show, compare, import: importReports, store };

export function isCommand(word) {
  return Object.hasOwn(COMMANDS, word);
}

COMMANDS.presets = await import("./presets.js");
