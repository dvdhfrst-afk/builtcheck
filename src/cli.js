// The command line interface. Exit codes: 0 clean, 1 problems found, 2 could not run or could
// not finish.

import { accessSync, constants, existsSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { audit, version } from "./audit.js";
import { ConfigError, DEFAULT_SITE, readConfigFile } from "./engine/config.js";
import { formatGithub } from "./report/github.js";
import { formatHtml } from "./report/html.js";
import { formatJson } from "./report/json.js";
import { printable } from "./report/printable.js";
import { formatSarif } from "./report/sarif.js";
import { formatText } from "./report/text.js";
import { TASTE_RULES } from "./rules/taste.js";
import { allRules } from "./rules/index.js";

const DEFAULT_CONFIG_FILE = "builtcheck.config.json";
const FORMATS = new Set(["text", "json", "html", "github", "sarif"]);

const HELP = `builtcheck: audit a built static site folder, offline.

Usage:
  builtcheck <folder> [options]
  builtcheck --init [--site-url <url>]
  builtcheck --explain <rule>

Options:
  --format <name>            text (default), json, html, github or sarif
  --output <file>            Write the report to a file instead of stdout. Must be outside the site folder
  --config <file>            Config file (default: ${DEFAULT_CONFIG_FILE} in the current folder, if present)
  --no-config                Ignore any config file and use the defaults
  --site-url <url>           The URL the site deploys to, so absolute links to it count as internal
  --base-path <path>         The path the site deploys under, such as /docs
  --only <rules>             Run only these rules, as ids or groups such as links/*, separated by commas
  --skip <rules>             Do not run these rules
  --max-warnings <n>         Also fail if there are more than n warnings
  --quiet                    In text output, list errors only
  --all                      In text output, list every finding with nothing collapsed
  --no-color                 Plain text output
  --init                     Write a starter ${DEFAULT_CONFIG_FILE} in the current folder
  --explain <rule>           Describe a rule and its options
  --list-rules               List every rule with its default severity
  --print-config             Print a config file with every default filled in
  --version, -v              Print the version
  --help, -h                 Print this help

Exit codes:
  0  no errors, and warnings within any limit you set
  1  errors found, or more warnings than --max-warnings allows
  2  could not run, or could not finish: nothing is certain about the site
`;

class UsageError extends Error {}

const VALUE_FLAGS = new Set(["format", "output", "config", "site-url", "base-path", "max-warnings", "explain"]);
const LIST_FLAGS = new Set(["only", "skip"]);
const BOOLEAN_FLAGS = new Set(["no-config", "quiet", "all", "no-color", "list-rules", "print-config", "init", "version", "help"]);

export function parseArguments(argv) {
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-") && argument !== "-") {
        if (argument === "-h") options.help = true;
        else if (argument === "-v") options.version = true;
        else throw new UsageError(`Unknown option: ${argument}. See --help.`);
        continue;
      }
      options.positional.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) throw new UsageError(`--${name} does not take a value`);
      options[name] = true;
    } else if (VALUE_FLAGS.has(name) || LIST_FLAGS.has(name)) {
      let value;
      if (equals !== -1) value = argument.slice(equals + 1);
      else {
        i += 1;
        value = argv[i];
      }
      if (value === undefined || value === "") throw new UsageError(`--${name} needs a value`);
      if (LIST_FLAGS.has(name)) options[name] = [...(options[name] ?? []), ...value.split(",").map((part) => part.trim()).filter(Boolean)];
      else options[name] = value;
    } else {
      throw new UsageError(`Unknown option: --${name}. See --help.`);
    }
  }
  return options;
}

function listRules(write) {
  for (const rule of allRules) {
    write(`${rule.severity.padEnd(8)} ${rule.id}\n         ${rule.description}\n`);
  }
}

function explainRule(id, write) {
  const rule = allRules.find((candidate) => candidate.id === id);
  if (!rule) {
    const close = allRules.filter((candidate) => candidate.id.includes(id)).map((candidate) => candidate.id);
    throw new UsageError(`"${id}" is not a rule.${close.length > 0 ? ` Did you mean: ${close.join(", ")}?` : " See --list-rules."}`);
  }
  write(`${rule.id}\n\nDefault severity: ${rule.severity}\n\n${rule.description}\n`);
  if (rule.options && Object.keys(rule.options).length > 0) {
    write(`\nOptions and their defaults:\n${JSON.stringify(rule.options, null, 2)}\n`);
  }
  write(`\nTo turn it off, or to change its severity or options, add it to "rules" in ${DEFAULT_CONFIG_FILE}:\n  "rules": { "${rule.id}": "off" }\n`);
}

function fullConfig() {
  const rules = {};
  for (const rule of allRules) {
    rules[rule.id] = { severity: rule.severity, ...(rule.options ?? {}) };
  }
  return { site: DEFAULT_SITE, ignore: [], rules };
}

// A short file to start from, naming the rules that are matters of taste, since those are the
// first most people want to change.
function starterConfig(options) {
  const starter = {
    site: options["site-url"] ? { url: options["site-url"] } : {},
    ignore: [],
    rules: {
      ...Object.fromEntries(TASTE_RULES.map((rule) => [rule, "warning"])),
    },
  };
  return `${JSON.stringify(starter, null, 2)}\n`;
}

function writeStarterConfig(options, io) {
  try {
    // The "wx" flag refuses to replace an existing file, without a gap between check and write.
    writeFileSync(DEFAULT_CONFIG_FILE, starterConfig(options), { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new UsageError(`${DEFAULT_CONFIG_FILE} already exists, so it was left as it is`);
    throw new UsageError(`Cannot write ${DEFAULT_CONFIG_FILE}: ${plainError(error)}`);
  }
  io.stdout(`Wrote ${DEFAULT_CONFIG_FILE}. See the README for the settings it can hold.\n`);
}

function loadConfig(options) {
  let config = {};
  if (options.config) {
    if (options["no-config"]) throw new UsageError("--config and --no-config cannot be combined");
    config = readConfigFile(options.config);
  } else if (!options["no-config"] && existsSync(DEFAULT_CONFIG_FILE)) {
    config = readConfigFile(DEFAULT_CONFIG_FILE);
  }
  if (options["site-url"] || options["base-path"]) {
    if (config === null || typeof config !== "object" || Array.isArray(config)) throw new ConfigError("Config must be a JSON object");
    if (config.site !== undefined && (config.site === null || typeof config.site !== "object")) {
      throw new ConfigError('"site" must be an object');
    }
    config = { ...config, site: { ...config.site } };
    if (options["site-url"]) config.site.url = options["site-url"];
    if (options["base-path"]) config.site.basePath = options["base-path"];
  }
  return config;
}

function parseMaxWarnings(text) {
  if (text === undefined) return null;
  if (!/^\d+$/.test(text)) throw new UsageError(`--max-warnings needs a whole number, not "${text}"`);
  return Number(text);
}

function requireFolder(path) {
  const root = resolve(path);
  if (!existsSync(root)) throw new UsageError(`Folder not found: ${path}`);
  if (!statSync(root).isDirectory()) throw new UsageError(`Not a folder: ${path}. Give the folder your build writes to.`);
  return root;
}

function plainError(error) {
  const reasons = {
    EACCES: "permission denied",
    EPERM: "permission denied",
    EBUSY: "the file is locked by another program",
    ENOSPC: "the disk is full",
    EROFS: "the disk is read-only",
    EISDIR: "that path is a folder",
    ENOTDIR: "part of that path is not a folder",
    ENOENT: "no such file or folder",
    ENAMETOOLONG: "the path is too long",
    ELOOP: "the path loops through symbolic links",
    EMFILE: "too many files are open",
    EIO: "the disk reported an error",
  };
  return reasons[error.code] ?? error.message;
}

const LIKELY_BUILD_FOLDERS = ["dist", "out", "build", "_site", "public", "site"];

function noPagesMessage(folder, root) {
  const found = LIKELY_BUILD_FOLDERS.filter((name) => existsSync(join(root, name, "index.html")));
  const hint = found.length > 0 ? ` Did you mean ${found.map((name) => `${folder.replace(/[\\/]+$/, "")}/${name}`).join(" or ")}?` : " Point it at the build output, and run the build first.";
  return `no HTML pages in ${folder}.${hint}`;
}

function isSameOrInside(folder, path) {
  const fold = (text) => (process.platform === "win32" ? text.toLowerCase() : text);
  const parent = fold(folder);
  const child = fold(path);
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

// Writes beside the target and renames over it, so a failed or interrupted run leaves the
// previous report as it was instead of half of a new one.
// The path a write will really reach, through any symbolic link in the file or its folders.
function reachedPath(path) {
  for (const [base, rest] of [[path, ""], [dirname(path), basename(path)]]) {
    try {
      return join(realpathSync(base), rest);
    } catch {
      // Not there yet, so try its folder.
    }
  }
  return path;
}

function refuse(code) {
  throw Object.assign(new Error(code), { code });
}

// Writes the whole report or none of it: an interrupted or failed run leaves any earlier report
// as it was. A device or pipe has no content to protect, and renaming over one would replace it.
function writeReport(path, report, root) {
  const target = reachedPath(resolve(path));
  if (isSameOrInside(root, resolve(path)) || isSameOrInside(reachedPath(root), target)) {
    throw new UsageError(`--output ${path} is inside the site folder. A report there would be audited, and deployed, as part of the site. Write it somewhere else.`);
  }
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    const existing = statSync(target, { throwIfNoEntry: false });
    if (existing?.isDirectory()) refuse("EISDIR");
    if (existing && !existing.isFile()) {
      writeFileSync(target, report);
      return;
    }
    if (existing) accessSync(target, constants.W_OK);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(temporary, report);
    renameSync(temporary, target);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // The folder itself may be what failed, and then there is nothing to remove.
    }
    throw new UsageError(`Cannot write ${path}: ${plainError(error)}`);
  }
}

function render(result, format, options, io) {
  if (format === "json") return formatJson(result);
  if (format === "html") return formatHtml(result);
  if (format === "github") return formatGithub(result);
  if (format === "sarif") return formatSarif(result, allRules);
  return formatText(result, {
    color: Boolean(io.isTty) && !options["no-color"] && !options.output && !process.env.NO_COLOR,
    showAll: Boolean(options.all),
    quiet: Boolean(options.quiet),
  });
}

// `io` holds stdout, stderr and whether stdout is a color terminal, so tests can run this directly.
export function main(argv, io) {
  try {
    const options = parseArguments(argv);
    if (options.help) {
      io.stdout(HELP);
      return 0;
    }
    if (options.version) {
      io.stdout(`${version}\n`);
      return 0;
    }
    if (options["list-rules"]) {
      listRules(io.stdout);
      return 0;
    }
    if (options["print-config"]) {
      io.stdout(`${JSON.stringify(fullConfig(), null, 2)}\n`);
      return 0;
    }
    if (options.explain) {
      explainRule(options.explain, io.stdout);
      return 0;
    }
    if (options.init) {
      writeStarterConfig(options, io);
      return 0;
    }

    if (options.positional.length !== 1) {
      throw new UsageError(options.positional.length === 0 ? "Give the built site folder to audit, such as: builtcheck dist" : `Give exactly one folder, not ${options.positional.length}`);
    }
    const format = options.format ?? "text";
    if (!FORMATS.has(format)) throw new UsageError(`--format must be text, json, html, github or sarif, not "${format}"`);
    const maxWarnings = parseMaxWarnings(options["max-warnings"]);
    const folder = options.positional[0];
    const root = requireFolder(folder);
    const config = loadConfig(options);

    const result = audit(root, config, allRules, { only: options.only, skip: options.skip });
    for (const { file, reason, incomplete } of result.skipped) {
      if (incomplete) io.stderr(`builtcheck: ${printable(file)}: ${printable(reason)}\n`);
    }
    if (result.summary.pages === 0) {
      io.stderr(`builtcheck: ${printable(noPagesMessage(folder, root))}\n`);
      return 2;
    }
    result.root = folder;

    const report = render(result, format, options, io);
    const { errors, warnings } = result.summary;
    if (options.output) {
      writeReport(options.output, report, root);
      io.stdout(`${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}. Report written to ${printable(options.output)}\n`);
    } else {
      io.stdout(report);
    }

    if (!result.complete) {
      io.stderr("builtcheck: the audit is incomplete, so the exit code is 2 whatever was found. See the messages above.\n");
      return 2;
    }
    if (errors > 0) return 1;
    if (maxWarnings !== null && warnings > maxWarnings) return 1;
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError) {
      io.stderr(`builtcheck: ${printable(error.message)}\n`);
      return 2;
    }
    if (error.code) {
      io.stderr(`builtcheck: could not read the site folder: ${plainError(error)}\n`);
      return 2;
    }
    const detail = process.env.BUILTCHECK_DEBUG ? (error.stack ?? error.message) : `${error.message}. Set BUILTCHECK_DEBUG=1 to see where.`;
    io.stderr(`builtcheck: this is a bug in builtcheck, not in your site: ${detail}\n`);
    return 2;
  }
}
