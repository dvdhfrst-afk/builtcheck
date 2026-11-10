// The query parameters of the API, and what they do to a run's findings: filtering, sorting,
// grouping and paging. Everything here is pure, so it can be tested without a server.

import { ruleGroup } from "../report/rules.js";
import { HttpError } from "./http.js";

const SEARCH_LIMIT = 200;

function quoted(text) {
  const value = String(text);
  return `"${value.length > 40 ? `${value.slice(0, 40)}...` : value}"`;
}

// The parameters of one request, each at most once, and only those the route takes, so a typing
// mistake in a parameter's name is an error rather than a filter silently left out.
export function readQuery(params, allowed) {
  const values = {};
  for (const [name, value] of params) {
    if (!allowed.includes(name)) {
      throw new HttpError(400, `Unknown parameter ${quoted(name)}. ${allowed.length > 0 ? `This route takes ${allowed.join(", ")}.` : "This route takes none."}`);
    }
    if (Object.hasOwn(values, name)) throw new HttpError(400, `Give the parameter ${name} once.`);
    values[name] = value;
  }
  return values;
}

export function wholeNumber(text, name, min, max) {
  if (!/^\d{1,9}$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new HttpError(400, `${name} must be a whole number from ${min} to ${max}, not ${quoted(text)}.`);
  }
  return Number(text);
}

export const PAGING = ["offset", "limit"];

export function paging(values, defaultLimit, maxLimit) {
  return {
    offset: values.offset === undefined ? 0 : wholeNumber(values.offset, "offset", 0, 1e9),
    limit: values.limit === undefined ? defaultLimit : wholeNumber(values.limit, "limit", 1, maxLimit),
  };
}

export function page(items, { offset, limit }) {
  return { total: items.length, offset, limit, items: items.slice(offset, offset + limit) };
}

export function oneOf(text, name, choices, fallback) {
  if (text === undefined) return fallback;
  if (!choices.includes(text)) throw new HttpError(400, `${name} must be ${choices.slice(0, -1).join(", ")} or ${choices[choices.length - 1]}, not ${quoted(text)}.`);
  return text;
}

function list(text) {
  return text.split(",").map((part) => part.trim()).filter(Boolean);
}

export const FILTERS = ["severity", "rule", "group", "file", "q"];

// The filter the parameters describe. `rule` and `group` take several values separated by
// commas. `file` is one exact path, since a file name may hold a comma. `q` is a search, without
// regard to case, of the message, file and rule.
export function filterFrom(values) {
  const filter = {};
  if (values.severity !== undefined) {
    filter.severity = list(values.severity);
    for (const severity of filter.severity) oneOf(severity, "severity", ["error", "warning"]);
    if (filter.severity.length === 0) throw new HttpError(400, "severity must be error, warning, or both separated by a comma.");
  }
  for (const name of ["rule", "group"]) {
    if (values[name] === undefined) continue;
    filter[name] = list(values[name]);
    if (filter[name].length === 0) throw new HttpError(400, `${name} needs a value.`);
  }
  if (values.file !== undefined) {
    if (values.file === "") throw new HttpError(400, "file needs a value.");
    filter.file = values.file;
  }
  if (values.q !== undefined) {
    if (values.q.length > SEARCH_LIMIT) throw new HttpError(400, `q can be at most ${SEARCH_LIMIT} characters.`);
    if (values.q.trim() !== "") filter.q = values.q.trim().toLowerCase();
  }
  return filter;
}

export function matches(finding, filter) {
  if (filter.severity && !filter.severity.includes(finding.severity)) return false;
  if (filter.rule && !filter.rule.includes(finding.rule)) return false;
  if (filter.group && !filter.group.includes(ruleGroup(finding.rule))) return false;
  if (filter.file !== undefined && finding.file !== filter.file) return false;
  if (filter.q && ![finding.message, finding.file, finding.rule].some((text) => text.toLowerCase().includes(filter.q))) return false;
  return true;
}

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPosition(a, b) {
  return compareText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || compareText(a.rule, b.rule) || compareText(a.message, b.message);
}

const SEVERITY_ORDER = { error: 0, warning: 1 };

const SORTS = {
  position: byPosition,
  severity: (a, b) => (SEVERITY_ORDER[a.severity] ?? 2) - (SEVERITY_ORDER[b.severity] ?? 2) || byPosition(a, b),
  rule: (a, b) => compareText(a.rule, b.rule) || byPosition(a, b),
  message: (a, b) => compareText(a.message.toLowerCase(), b.message.toLowerCase()) || byPosition(a, b),
};

export const SORT_NAMES = Object.keys(SORTS);

export function sortFindings(findings, sort = "position", order = "asc") {
  const sorted = [...findings].sort(SORTS[sort]);
  return order === "desc" ? sorted.reverse() : sorted;
}

// The findings of a run that the parameters ask for, sorted, and the page of them to send.
export function selectFindings(findings, values) {
  const filter = filterFrom(values);
  const sort = oneOf(values.sort, "sort", SORT_NAMES, "position");
  const order = oneOf(values.order, "order", ["asc", "desc"], "asc");
  const chosen = findings.filter((finding) => matches(finding, filter));
  return { filter, sort, order, chosen: sortFindings(chosen, sort, order) };
}

const KEYS = {
  file: (finding) => finding.file,
  rule: (finding) => finding.rule,
  group: (finding) => ruleGroup(finding.rule),
};

export const GROUPINGS = Object.keys(KEYS);

// Findings counted by file, rule or rule group. "count" puts the groups with the most errors
// first, then the most warnings; "name" sorts them by name.
export function groupFindings(findings, by, sort = "count") {
  const groups = new Map();
  for (const finding of findings) {
    const key = KEYS[by](finding);
    if (!groups.has(key)) groups.set(key, { key, errors: 0, warnings: 0, findings: 0 });
    const group = groups.get(key);
    group.findings += 1;
    if (finding.severity === "error") group.errors += 1;
    else if (finding.severity === "warning") group.warnings += 1;
  }
  const byName = (a, b) => compareText(a.key, b.key);
  const byCount = (a, b) => b.errors - a.errors || b.warnings - a.warnings || b.findings - a.findings || byName(a, b);
  return [...groups.values()].sort(sort === "name" ? byName : byCount);
}

// What a run page needs to offer its filters: the rule groups and rules with findings, with
// their counts, and how many files have findings.
export function facetsFor(findings) {
  return {
    groups: groupFindings(findings, "group", "name"),
    rules: groupFindings(findings, "rule", "name"),
    files: new Set(findings.map((finding) => finding.file)).size,
  };
}
