// Loads and validates configuration, and merges it over the defaults each rule declares.

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { applyPreset, PRESET_NAMES, PRESET_PREFIX, PRESETS } from "./presets.js";
import { ruleMatches } from "./suppressions.js";

export class ConfigError extends Error {}

export const DEFAULT_SITE = {
  url: null,
  basePath: null,
  externalPaths: [],
  sitemapPaths: ["sitemap.xml", "sitemap-index.xml", "sitemap_index.xml", "sitemap.xml.gz"],
  socialImagePaths: [
    "og-default.png", "og-default.jpg", "og-default.jpeg",
    "og-image.png", "og-image.jpg", "og-image.jpeg",
    "og.png", "og.jpg", "og.jpeg",
    "social.png", "social.jpg", "social-card.png", "social-card.jpg",
    "share.png", "share.jpg", "opengraph-image.png", "opengraph-image.jpg",
    "images/og-default.png", "images/og-default.jpg", "img/og-default.png", "img/og-default.jpg",
    "assets/og-default.png", "assets/og-default.jpg",
  ],
};

const SEVERITIES = new Set(["error", "warning", "off"]);
const SEVERITY_ALIASES = { warn: "warning" };

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function parseSeverity(value, where) {
  const severity = SEVERITY_ALIASES[value] ?? value;
  if (!SEVERITIES.has(severity)) {
    throw new ConfigError(`${where}: severity must be "error", "warning" or "off", not ${JSON.stringify(value)}`);
  }
  return severity;
}

function validateSite(site) {
  if (!isPlainObject(site)) throw new ConfigError('"site" must be an object');
  for (const key of Object.keys(site)) {
    if (!(key in DEFAULT_SITE)) {
      throw new ConfigError(`site.${key} is not a setting. Known settings: ${Object.keys(DEFAULT_SITE).join(", ")}`);
    }
  }
  for (const key of ["url", "basePath"]) {
    if (site[key] !== undefined && site[key] !== null && typeof site[key] !== "string") {
      throw new ConfigError(`site.${key} must be a string`);
    }
  }
  for (const key of ["externalPaths", "sitemapPaths", "socialImagePaths"]) {
    if (site[key] !== undefined && !isStringArray(site[key])) {
      throw new ConfigError(`site.${key} must be an array of strings`);
    }
  }
  if (site.basePath && /^\/?[a-zA-Z]:[\\/]/.test(site.basePath)) {
    throw new ConfigError(`site.basePath is a file path, not a URL path such as /docs: ${site.basePath}. Git Bash on Windows rewrites arguments that start with /, so write //docs there, or set it in a config file.`);
  }
  if (site.url) {
    let url;
    try {
      url = new URL(site.url);
    } catch {
      throw new ConfigError(`site.url is not a valid absolute URL: ${site.url}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new ConfigError(`site.url must be an http or https URL: ${site.url}`);
    }
  }
}

// Where saved runs go, and whether every run is saved. The command line can override both.
function validateStore(store) {
  if (store === undefined) return;
  if (!isPlainObject(store)) throw new ConfigError('"store" must be an object');
  for (const key of Object.keys(store)) {
    if (!["path", "save"].includes(key)) throw new ConfigError(`store.${key} is not a setting. Known settings: path, save`);
  }
  if (store.path !== undefined && (typeof store.path !== "string" || store.path === "")) throw new ConfigError("store.path must be a folder path");
  if (store.save !== undefined && typeof store.save !== "boolean") throw new ConfigError("store.save must be true or false");
}

function typeName(value) {
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

function checkOptionType(where, value, defaultValue) {
  if (defaultValue === null || defaultValue === undefined) return;
  if (typeName(value) !== typeName(defaultValue)) {
    throw new ConfigError(`${where} must be of type ${typeName(defaultValue)}, not ${typeName(value)}`);
  }
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

// Compares on the part after the group too, since "em-dash" alone is a likely mistake.
function closestRuleId(id, rules) {
  const tail = id.split("/").pop();
  let best = null;
  let bestDistance = Infinity;
  for (const rule of rules) {
    const distance = Math.min(editDistance(id, rule.id), editDistance(tail, rule.id.split("/").pop()));
    if (distance < bestDistance) {
      best = rule;
      bestDistance = distance;
    }
  }
  return best && bestDistance <= Math.max(2, Math.floor(tail.length / 3)) ? ` Did you mean "${best.id}"?` : "";
}

function applySetting(settings, rule, value, where) {
  if (typeof value === "string") {
    settings.severity = parseSeverity(value, where);
    return;
  }
  if (!isPlainObject(value)) {
    throw new ConfigError(`${where} must be a severity string or an object`);
  }
  for (const [key, optionValue] of Object.entries(value)) {
    if (key === "severity") {
      settings.severity = parseSeverity(optionValue, where);
      continue;
    }
    const defaults = rule.options ?? {};
    if (!(key in defaults)) {
      const known = Object.keys(defaults);
      throw new ConfigError(
        `${where}: "${key}" is not an option of ${rule.id}. ${known.length ? `Options: ${known.join(", ")}` : "It has no options."}`,
      );
    }
    checkOptionType(`${where}.${key}`, optionValue, defaults[key]);
    // Object options merge by key, so one type's field list can change without restating all.
    settings.options[key] = isPlainObject(defaults[key]) ? { ...settings.options[key], ...optionValue } : optionValue;
  }
}

// Applies one config's "rules" over `resolved`. Groups first, so an exact rule entry wins no
// matter the order in the file.
function applyRules(resolved, userRules, rules) {
  const entries = Object.entries(userRules);
  // Likewise "*" before named groups, wherever each appears.
  const groups = entries
    .filter(([key]) => key.endsWith("/*") || key === "*")
    .sort(([a], [b]) => a.length - b.length);
  const exact = entries.filter(([key]) => !(key.endsWith("/*") || key === "*"));
  for (const [key, value] of groups) {
    const prefix = key === "*" ? "" : key.slice(0, -1);
    const members = rules.filter((rule) => rule.id.startsWith(prefix));
    if (members.length === 0) throw new ConfigError(`rules."${key}" matches no rule`);
    if (typeof value !== "string") throw new ConfigError(`rules."${key}": a group takes only a severity string`);
    for (const rule of members) applySetting(resolved[rule.id], rule, value, `rules."${key}"`);
  }
  for (const [key, value] of exact) {
    const rule = rules.find((candidate) => candidate.id === key);
    if (!rule) throw new ConfigError(`rules."${key}" is not a rule.${closestRuleId(key, rules)}`);
    // Setting a rule's options asks for that rule, so a group turned off above does not hide it.
    if (isPlainObject(value) && value.severity === undefined && resolved[key].severity === "off") {
      resolved[key].severity = rule.severity;
    }
    applySetting(resolved[key], rule, value, `rules."${key}"`);
    validateOptions(rule, resolved[key].options);
  }
}

function validateOptions(rule, options) {
  try {
    rule.validate?.(options);
  } catch (error) {
    throw new ConfigError(`rules."${rule.id}": ${error.message}`);
  }
}

const SETTINGS = ["extends", "site", "ignore", "rules", "store"];

// The checks one config makes on its own, before anything it extends is read. Returns what it
// extends, as a list.
function validateLayer(user, extended) {
  if (!isPlainObject(user)) throw new ConfigError("Config must be a JSON object");
  for (const key of Object.keys(user)) {
    if (!SETTINGS.includes(key)) {
      throw new ConfigError(`"${key}" is not a config setting. Known settings: ${SETTINGS.join(", ")}`);
    }
  }
  // Store settings say where this machine keeps its runs, so they belong to the file run with.
  if (extended && user.store !== undefined) {
    throw new ConfigError('"store" can only be set in the config file builtcheck runs with, not in one it extends');
  }
  validateStore(user.store);
  validateSite(user.site ?? {});
  if (user.ignore !== undefined && !isStringArray(user.ignore)) {
    throw new ConfigError('"ignore" must be an array of glob strings');
  }
  if (user.rules !== undefined && !isPlainObject(user.rules)) throw new ConfigError('"rules" must be an object');
  const list = user.extends === undefined ? [] : typeof user.extends === "string" ? [user.extends] : user.extends;
  if (!isStringArray(list) || list.some((entry) => entry === "")) {
    throw new ConfigError('"extends" must be a preset name or a config file path, or a list of them');
  }
  return list;
}

// A file named in a chain: relative to the current folder when it is inside it, else in full.
function displayPath(path) {
  const short = relative(process.cwd(), path);
  return short === "" || isAbsolute(short) || /^\.\.([\\/]|$)/.test(short) ? path : short;
}

function chainText(chain) {
  return `extends ${chain.join(" -> ")}`;
}

// Runs `fn`, naming the extends chain in any config mistake it finds, since the file at fault is
// then not the one the user ran with.
function inChain(chain, fn) {
  if (chain.length === 0) return fn();
  try {
    return fn();
  } catch (error) {
    if (error instanceof ConfigError) throw new ConfigError(`${chainText(chain)}: ${error.message}`);
    throw error;
  }
}

function closestPreset(name) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of PRESET_NAMES) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return bestDistance <= 3 ? ` Did you mean "${best}"?` : "";
}

const fileKey = (path) => (process.platform === "win32" ? path.toLowerCase() : path);

// Lists the configs to apply, in order: what a config extends comes before it, in the order it
// names them, so later entries win and the config itself wins over all of them. A layer is
// { config, chain } for a config object or { preset } for a built-in preset. `files` holds the
// files on the current path, to catch a chain that comes back to a file it passed through.
function collectLayers(user, chain, files, layers) {
  const list = inChain(chain, () => validateLayer(user, chain.length > 0));
  for (const entry of list) {
    if (entry.startsWith(PRESET_PREFIX)) {
      if (!Object.hasOwn(PRESETS, entry)) {
        throw new ConfigError(`${chainText([...chain, entry])}: "${entry}" is not a built-in preset.${closestPreset(entry)} Presets: ${PRESET_NAMES.join(", ")}`);
      }
      layers.push({ preset: PRESETS[entry] });
      continue;
    }
    // The reader of a file made its paths absolute; a config built in code means the current folder.
    const path = resolve(entry);
    const next = [...chain, displayPath(path)];
    if (files.includes(fileKey(path))) throw new ConfigError(`${chainText(next)}: the chain comes back to a file it already passed through`);
    let config;
    try {
      config = readConfig(path, displayPath(path));
    } catch (error) {
      if (error instanceof ConfigError) throw new ConfigError(`${error.message} (${chainText(next)})`);
      throw error;
    }
    collectLayers(config, next, [...files, fileKey(path)], layers);
  }
  layers.push({ config: user, chain });
  return layers;
}

// Combines a user config, and every preset and file it extends, with rule defaults. Result:
//   { site, ignore, store, rules: { [id]: { severity, options } } }
export function resolveConfig(user, rules, selection = {}) {
  const layers = collectLayers(user, [], [], []);

  const resolved = {};
  for (const rule of rules) {
    resolved[rule.id] = { severity: rule.severity, options: structuredClone(rule.options ?? {}) };
  }
  // Site settings replace each other key by key. Ignore patterns add up, since a shared config
  // leaving out its own drafts does not mean a project wants its drafts audited.
  let site = {};
  const ignore = [];
  for (const layer of layers) {
    if (layer.preset) {
      applyPreset(layer.preset, resolved, rules);
      continue;
    }
    inChain(layer.chain, () => applyRules(resolved, layer.config.rules ?? {}, rules));
    site = { ...site, ...(layer.config.site ?? {}) };
    for (const pattern of layer.config.ignore ?? []) if (!ignore.includes(pattern)) ignore.push(pattern);
  }

  const only = selection.only ?? [];
  const skip = selection.skip ?? [];
  for (const pattern of [...only, ...skip]) {
    if (!rules.some((rule) => ruleMatches([pattern], rule.id))) {
      throw new ConfigError(`"${pattern}" matches no rule.${closestRuleId(pattern, rules)}`);
    }
  }
  for (const rule of rules) {
    if ((only.length > 0 && !ruleMatches(only, rule.id)) || ruleMatches(skip, rule.id)) resolved[rule.id].severity = "off";
  }

  for (const rule of rules) validateOptions(rule, resolved[rule.id].options);

  return {
    site: { ...DEFAULT_SITE, ...site },
    ignore,
    store: { ...(user.store ?? {}) },
    rules: resolved,
  };
}

// The resolved config written out as a config file: every default filled in and nothing left to
// extend, so it reads back as it is. --print-config and `builtcheck presets <name>` print this.
export function printableConfig(user, rules) {
  const config = resolveConfig(user, rules);
  const printed = { site: config.site, ignore: config.ignore, rules: {} };
  for (const rule of rules) {
    const { severity, options } = config.rules[rule.id];
    printed.rules[rule.id] = { severity, ...options };
  }
  if (Object.keys(config.store).length > 0) printed.store = config.store;
  return printed;
}

export function readConfigFile(path) {
  return readConfig(path, path);
}

// `label` is how messages name the file.
function readConfig(path, label) {
  let text;
  try {
    const buffer = readFileSync(path);
    // Some shells write redirected output as UTF-16 with a byte order mark.
    text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString("utf16le") : buffer.toString("utf8");
  } catch (error) {
    const reason = { ENOENT: "no such file", EISDIR: "that path is a folder", EACCES: "permission denied", EPERM: "permission denied", EBUSY: "the file is locked by another program", ENOTDIR: "part of that path is not a folder" }[error.code];
    throw new ConfigError(`Cannot read config file ${label}: ${reason ?? error.message}`);
  }
  let config;
  try {
    config = JSON.parse(text.replace(/^\ufeff/, ""));
  } catch (error) {
    throw new ConfigError(`Config file ${label} is not valid JSON: ${error.message}`);
  }
  // Only the reader knows where the file is, so the files it extends become absolute paths here,
  // and mean the same wherever the object is passed or copied to.
  if (isPlainObject(config)) {
    const folder = dirname(resolve(path));
    const anchor = (entry) => (typeof entry === "string" && entry !== "" && !entry.startsWith(PRESET_PREFIX) ? resolve(folder, entry) : entry);
    if (typeof config.extends === "string") config.extends = anchor(config.extends);
    else if (Array.isArray(config.extends)) config.extends = config.extends.map(anchor);
  }
  return config;
}
