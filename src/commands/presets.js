// `builtcheck presets`: lists the built-in presets a config file can extend, or prints one as
// the full config it resolves to, so nobody has to guess what a preset turns on.

import { printableConfig } from "../engine/config.js";
import { PRESET_NAMES, PRESET_PREFIX, PRESETS } from "../engine/presets.js";
import { printable } from "../report/printable.js";
import { allRules } from "../rules/index.js";

export const summary = "List the built-in config presets, or print one resolved";

export const usage = `builtcheck presets: list the built-in config presets, or print one as the config it resolves to.

Usage:
  builtcheck presets            List the built-in presets
  builtcheck presets <name>     Print a preset as the full config it resolves to

A config file starts from presets with "extends". Later entries win, and the file's own
settings win over everything it extends:
  { "extends": ["builtcheck:seo", "builtcheck:strict"], "rules": { "links/placeholder-href": "off" } }
`;

// "31 of 39 rules on, 20 as errors"
function counts(name) {
  const severities = Object.values(printableConfig({ extends: name }, allRules).rules).map((settings) => settings.severity);
  const on = severities.filter((severity) => severity !== "off").length;
  const errors = severities.filter((severity) => severity === "error").length;
  return `${on} of ${allRules.length} rules on, ${errors} as errors`;
}

function list(io) {
  for (const name of PRESET_NAMES) {
    io.stdout(`${name}  (${counts(name)})\n    ${PRESETS[name].description}\n`);
  }
  io.stdout(`\nRun builtcheck presets <name> to see one in full.\n`);
}

export function run(argv, io) {
  if (argv.includes("--help") || argv.includes("-h")) {
    io.stdout(usage);
    return 0;
  }
  const fail = (message) => {
    io.stderr(`builtcheck: ${printable(message)}\n`);
    return 2;
  };
  const option = argv.find((argument) => argument.startsWith("-"));
  if (option) return fail(`Unknown option for presets: ${option}. See builtcheck presets --help.`);
  if (argv.length > 1) return fail(`Give one preset name, not ${argv.length}`);
  if (argv.length === 0) {
    list(io);
    return 0;
  }
  // "strict" is enough, since the prefix is the same for every built-in preset.
  const name = argv[0].startsWith(PRESET_PREFIX) ? argv[0] : `${PRESET_PREFIX}${argv[0]}`;
  if (!Object.hasOwn(PRESETS, name)) return fail(`"${argv[0]}" is not a built-in preset. Presets: ${PRESET_NAMES.join(", ")}`);
  io.stdout(`${JSON.stringify(printableConfig({ extends: name }, allRules), null, 2)}\n`);
  return 0;
}
