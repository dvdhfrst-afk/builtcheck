// What the store commands share: reading their options, finding the store they mean, and laying
// out plain text.

import { loadConfig, UsageError } from "../cli.js";
import { resolveConfig } from "../engine/config.js";
import { printable } from "../report/printable.js";
import { allRules } from "../rules/index.js";
import { DEFAULT_STORE, openStore } from "./index.js";

// Every store command takes these, as well as its own.
const COMMON_VALUES = ["store", "config", "format"];
const COMMON_BOOLEANS = ["help", "no-config"];

// Reads `argv` for the command `name`. `values` and `booleans` name its own options.
export function readOptions(name, argv, { values = [], booleans = [] } = {}) {
  const valueFlags = new Set([...COMMON_VALUES, ...values]);
  const booleanFlags = new Set([...COMMON_BOOLEANS, ...booleans]);
  const options = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      if (argument.startsWith("-") && argument !== "-") throw new UsageError(`Unknown option for builtcheck ${name}: ${argument}. See builtcheck ${name} --help.`);
      options.positional.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const flag = equals === -1 ? argument.slice(2) : argument.slice(2, equals);
    if (booleanFlags.has(flag)) {
      if (equals !== -1) throw new UsageError(`--${flag} does not take a value`);
      options[flag] = true;
    } else if (valueFlags.has(flag)) {
      const value = equals === -1 ? argv[(i += 1)] : argument.slice(equals + 1);
      if (value === undefined || value === "") throw new UsageError(`--${flag} needs a value`);
      options[flag] = value;
    } else {
      throw new UsageError(`Unknown option for builtcheck ${name}: --${flag}. See builtcheck ${name} --help.`);
    }
  }
  return options;
}

// The store named by --store, or by "store.path" in the config file, or the default.
export function storeFrom(options, cwd = process.cwd()) {
  const config = loadConfig({ config: options.config, "no-config": options["no-config"] });
  resolveConfig(config, allRules);
  return openStore(options.store ?? config?.store?.path ?? DEFAULT_STORE.path, { cwd });
}

export function outputFormat(options, allowed = ["text", "json"]) {
  const format = options.format ?? "text";
  if (!allowed.includes(format)) throw new UsageError(`--format must be ${allowed.slice(0, -1).join(", ")} or ${allowed[allowed.length - 1]}, not "${format}"`);
  return format;
}

export function wholeNumber(text, flag) {
  if (text === undefined) return null;
  if (!/^\d+$/.test(text)) throw new UsageError(`${flag} needs a whole number, not "${text}"`);
  return Number(text);
}

export function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// A time in the local time zone, to the minute, which is what a person reading a list wants.
export function localTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  const two = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

// How a run is named in text: its id, and its label if it has one.
export function runName(entry) {
  return entry.label ? `${entry.id} (${printable(entry.label)})` : entry.id;
}

// Columns padded to their widest cell. `right` holds the indexes of columns aligned right.
export function table(rows, right = []) {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)));
  return rows
    .map((row) => row.map((cell, column) => (right.includes(column) ? String(cell).padStart(widths[column]) : String(cell).padEnd(widths[column]))).join("  ").trimEnd())
    .join("\n");
}

export function bytes(count) {
  if (count < 1024) return plural(count, "byte");
  const units = ["KB", "MB", "GB"];
  let value = count / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
