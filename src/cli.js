// The command line interface. Exit codes: 0 clean, 1 problems found, 2 could not run.

import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { audit, version } from "./audit.js";
import { ConfigError, DEFAULT_SITE, readConfigFile } from "./engine/config.js";
import { formatHtml } from "./report/html.js";
import { formatJson } from "./report/json.js";
import { formatText } from "./report/text.js";
import { allRules } from "./rules/index.js";

const DEFAULT_CONFIG_FILE = "builtcheck.config.json";
const FORMATS = new Set(["text", "json", "html"]);

const HELP = `builtcheck: audit a built static site folder, offline.

Usage:
  builtcheck <folder> [options]

Options:
  --format <text|json|html>  Report format (default: text)
  --output <file>            Write the report to a file instead of stdout
  --config <file>            Config file (default: ${DEFAULT_CONFIG_FILE} in the current folder, if present)
  --no-config                Ignore any config file and use the defaults
  --site-url <url>           The URL the site deploys to, so absolute links to it count as internal
  --base-path <path>         The path the site deploys under, such as /docs
  --max-warnings <n>         Also fail if there are more than n warnings
  --quiet                    In text output, list errors only
  --all                      In text output, list every finding with nothing collapsed
  --no-color                 Plain text output
  --list-rules               List every rule with its default severity
  --print-config             Print a config file with every default filled in
  --version                  Print the version
  --help                     Print this help

Exit codes: 0 no problems, 1 problems found, 2 could not run.
`;

class UsageError extends Error {}

const VALUE_FLAGS = new Set(["format", "output", "config", "site-url", "base-path", "max-warnings"]);
const BOOLEAN_FLAGS = new Set(["no-config", "quiet", "all", "no-color", "list-rules", "print-config", "version", "help"]);

export function parseArguments(argv) {
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-") && argument !== "-") {
        if (argument === "-h") {
          options.help = true;
          continue;
        }
        throw new UsageError(`Unknown option: ${argument}`);
      }
      options.positional.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    if (BOOLEAN_FLAGS.has(name)) {
      if (equals !== -1) throw new UsageError(`--${name} does not take a value`);
      options[name] = true;
    } else if (VALUE_FLAGS.has(name)) {
      let value;
      if (equals !== -1) value = argument.slice(equals + 1);
      else {
        i += 1;
        value = argv[i];
      }
      if (value === undefined || value === "") throw new UsageError(`--${name} needs a value`);
      options[name] = value;
    } else {
      throw new UsageError(`Unknown option: --${name}`);
    }
  }
  return options;
}

function listRules(write) {
  for (const rule of allRules) {
    write(`${rule.severity.padEnd(8)} ${rule.id}\n         ${rule.description}\n`);
  }
}

function fullConfig() {
  const rules = {};
  for (const rule of allRules) {
    rules[rule.id] = { severity: rule.severity, ...(rule.options ?? {}) };
  }
  return { site: DEFAULT_SITE, ignore: [], rules };
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
  if (!statSync(root).isDirectory()) throw new UsageError(`Not a folder: ${path}`);
  return root;
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

    if (options.positional.length !== 1) {
      throw new UsageError(options.positional.length === 0 ? "Give the built site folder to audit, such as: builtcheck dist" : "Give exactly one folder");
    }
    const format = options.format ?? "text";
    if (!FORMATS.has(format)) throw new UsageError(`--format must be text, json or html, not "${format}"`);
    const maxWarnings = parseMaxWarnings(options["max-warnings"]);
    const folder = options.positional[0];
    const root = requireFolder(folder);
    const config = loadConfig(options);

    const result = audit(root, config);
    if (result.summary.pages === 0) {
      io.stderr(`builtcheck: no HTML pages in ${folder}. Point it at the build output, and run the build first.\n`);
      return 2;
    }
    result.root = folder;

    let report;
    if (format === "json") report = formatJson(result);
    else if (format === "html") report = formatHtml(result);
    else {
      report = formatText(result, {
        color: Boolean(io.isTty) && !options["no-color"] && !options.output && !process.env.NO_COLOR,
        showAll: Boolean(options.all),
        quiet: Boolean(options.quiet),
      });
    }

    if (options.output) {
      writeFileSync(options.output, report);
      const { errors, warnings } = result.summary;
      io.stdout(`${errors} errors, ${warnings} warnings. Report written to ${options.output}\n`);
    } else {
      io.stdout(report);
    }

    const { errors, warnings } = result.summary;
    if (errors > 0) return 1;
    if (maxWarnings !== null && warnings > maxWarnings) return 1;
    return 0;
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError) {
      io.stderr(`builtcheck: ${error.message}\n`);
      return 2;
    }
    io.stderr(`builtcheck: unexpected failure: ${error.stack ?? error.message}\n`);
    return 2;
  }
}
