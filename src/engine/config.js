// Loads and validates configuration, and merges it over the defaults each rule declares.

import { readFileSync } from "node:fs";
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

// Combines a user config with rule defaults. Result:
//   { site, ignore, rules: { [id]: { severity, options } } }
export function resolveConfig(user, rules, selection = {}) {
  if (!isPlainObject(user)) throw new ConfigError("Config must be a JSON object");
  for (const key of Object.keys(user)) {
    if (!["site", "ignore", "rules"].includes(key)) {
      throw new ConfigError(`"${key}" is not a config setting. Known settings: site, ignore, rules`);
    }
  }
  const site = user.site ?? {};
  validateSite(site);
  if (user.ignore !== undefined && !isStringArray(user.ignore)) {
    throw new ConfigError('"ignore" must be an array of glob strings');
  }
  const userRules = user.rules ?? {};
  if (!isPlainObject(userRules)) throw new ConfigError('"rules" must be an object');

  const resolved = {};
  for (const rule of rules) {
    resolved[rule.id] = { severity: rule.severity, options: structuredClone(rule.options ?? {}) };
  }

  // Groups first, so an exact rule entry wins no matter the order in the file.
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

  for (const rule of rules) {
    try {
      rule.validate?.(resolved[rule.id].options);
    } catch (error) {
      throw new ConfigError(`rules."${rule.id}": ${error.message}`);
    }
  }

  return {
    site: { ...DEFAULT_SITE, ...site },
    ignore: user.ignore ?? [],
    rules: resolved,
  };
}

export function readConfigFile(path) {
  let text;
  try {
    const buffer = readFileSync(path);
    // Some shells write redirected output as UTF-16 with a byte order mark.
    text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString("utf16le") : buffer.toString("utf8");
  } catch (error) {
    const reason = { ENOENT: "no such file", EISDIR: "that path is a folder", EACCES: "permission denied", EPERM: "permission denied", EBUSY: "the file is locked by another program", ENOTDIR: "part of that path is not a folder" }[error.code];
    throw new ConfigError(`Cannot read config file ${path}: ${reason ?? error.message}`);
  }
  try {
    return JSON.parse(text.replace(/^\ufeff/, ""));
  } catch (error) {
    throw new ConfigError(`Config file ${path} is not valid JSON: ${error.message}`);
  }
}
