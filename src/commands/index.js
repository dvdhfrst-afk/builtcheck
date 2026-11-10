// Commands other than auditing a folder. `builtcheck <command> ...` runs one; a folder whose name
// is the same as a command can still be audited by writing it as ./name.
//
// A command module exports `summary` (one line for --help), `usage` (its own help text) and
// `run(argv, io)`, which returns an exit code or a promise of one. `io` is the same object
// main() receives.

export const COMMANDS = {};

export function isCommand(word) {
  return Object.hasOwn(COMMANDS, word);
}
