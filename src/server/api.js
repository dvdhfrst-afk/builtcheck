// The JSON API under /api/. Its routes, parameters and answers are a contract, described in
// docs/web.md: a field may be added at any time, and apiVersion goes up when one changes or goes
// away.

import { version as toolVersion } from "../audit.js";
import { render } from "../cli.js";
import { notesFor } from "../commands/compare.js";
import { describeRun } from "../commands/show.js";
import { FORMAT_NAMES, FORMATS } from "../report/index.js";
import { ruleDocs, ruleGroup } from "../report/rules.js";
import { allRules } from "../rules/index.js";
import { compareResults, StoreError, STORE_VERSION } from "../store/index.js";
import { entryFor } from "../store/store.js";
import { HttpError, parseJsonObject, readBody } from "./http.js";
import { facetsFor, FILTERS, groupFindings, GROUPINGS, oneOf, page, PAGING, paging, readQuery, selectFindings } from "./query.js";

// How each report format is downloaded. A format added to the registry later still downloads,
// as plain text.
const DOWNLOADS = {
  text: { type: "text/plain; charset=utf-8", extension: "txt" },
  json: { type: "application/json; charset=utf-8", extension: "json" },
  html: { type: "text/html; charset=utf-8", extension: "html" },
  github: { type: "text/plain; charset=utf-8", extension: "txt" },
  sarif: { type: "application/sarif+json; charset=utf-8", extension: "sarif" },
  markdown: { type: "text/markdown; charset=utf-8", extension: "md" },
  junit: { type: "application/xml; charset=utf-8", extension: "xml" },
  csv: { type: "text/csv; charset=utf-8", extension: "csv" },
  codeclimate: { type: "application/json; charset=utf-8", extension: "json" },
  checkstyle: { type: "application/xml; charset=utf-8", extension: "xml" },
};

export function downloadFor(format) {
  return DOWNLOADS[format] ?? { type: "text/plain; charset=utf-8", extension: "txt" };
}

// A run as the commands name one: an id, the start of one, latest or latest~N.
const RUN_NAME = /^(?:latest(?:~\d{1,6})?|\d{1,8}(?:-\d{0,6}(?:-\d{0,3})?)?)$/;

// The run id a name leads to. A name that leads nowhere is 404; one that is not a run name at
// all, or is the start of several ids, is 400.
export function findRun(store, name) {
  if (!RUN_NAME.test(name)) throw new HttpError(400, `"${name.slice(0, 40)}" is not a run name. Use a run id, the start of one, latest, or latest~N for the run N before the latest.`);
  const ids = store.runIds();
  const several = !name.startsWith("latest") && !ids.includes(name) && ids.filter((id) => id.startsWith(name)).length > 1;
  try {
    return store.resolve(name);
  } catch (error) {
    if (error instanceof StoreError) throw new HttpError(several ? 400 : 404, error.message);
    throw error;
  }
}

function loadRun(store, name) {
  const id = findRun(store, name);
  try {
    return { id, ...store.load(id) };
  } catch (error) {
    if (error instanceof StoreError) throw new HttpError(500, error.message);
    throw error;
  }
}

function describeRule(rule) {
  return { id: rule.id, group: ruleGroup(rule.id), severity: rule.severity, description: rule.description, options: rule.options ?? {}, docs: ruleDocs(rule.id) };
}

function serverInfo(context) {
  const store = context.openStore();
  return {
    tool: "builtcheck",
    version: toolVersion,
    store: { path: store.shown, storeVersion: store.version || null },
    audits: { enabled: context.audits.enabled, site: context.audits.settings.site },
    formats: FORMAT_NAMES.map((name) => ({ name, description: FORMATS[name].description, extension: downloadFor(name).extension })),
  };
}

function storeInfo(context) {
  const store = context.openStore();
  const entries = store.entries();
  return {
    store: {
      path: store.shown,
      exists: store.version !== 0,
      storeVersion: store.version || null,
      current: store.version === STORE_VERSION,
      runs: entries.length,
      unreadable: store.unreadable,
      bytes: store.size(),
      oldest: entries[0] ?? null,
      newest: entries[entries.length - 1] ?? null,
    },
  };
}

function listRuns(context, _params, query) {
  const values = readQuery(query, PAGING);
  const store = context.openStore();
  const newestFirst = store.entries().reverse();
  const { items, ...counts } = page(newestFirst, paging(values, 50, 500));
  return { store: store.shown, storeVersion: store.version || null, ...counts, runs: items, unreadable: store.unreadable };
}

function showRun(context, params, query) {
  readQuery(query, []);
  const store = context.openStore();
  const { id, meta, result } = loadRun(store, params.run);
  const ids = store.runIds();
  const at = ids.indexOf(id);
  const { findings, ...rest } = result;
  return {
    run: entryFor(meta, result),
    meta,
    result: rest,
    previous: at > 0 ? ids[at - 1] : null,
    next: at >= 0 && at < ids.length - 1 ? ids[at + 1] : null,
    facets: facetsFor(findings),
  };
}

function listFindings(context, params, query) {
  const values = readQuery(query, [...FILTERS, "sort", "order", ...PAGING]);
  const { id, result } = loadRun(context.openStore(), params.run);
  const { filter, sort, order, chosen } = selectFindings(result.findings, values);
  const { items, ...counts } = page(chosen, paging(values, 100, 1000));
  return { run: id, filter, sort, order, ...counts, findings: items };
}

function listGroups(context, params, query) {
  const values = readQuery(query, ["by", ...FILTERS, "sort", ...PAGING]);
  const by = oneOf(values.by, "by", GROUPINGS, "file");
  const sort = oneOf(values.sort, "sort", ["count", "name"], "count");
  const { id, result } = loadRun(context.openStore(), params.run);
  const { filter, chosen } = selectFindings(result.findings, { ...values, by: undefined, sort: undefined });
  const { items, ...counts } = page(groupFindings(chosen, by, sort), paging(values, 100, 1000));
  return { run: id, by, sort, filter, findings: chosen.length, ...counts, groups: items };
}

// A saved run in any report format, as a file to save. A text report starts with the line
// `builtcheck show` gives it, since the report itself does not say when it ran.
function downloadReport(context, params, query) {
  const values = readQuery(query, ["format"]);
  const format = oneOf(values.format, "format", FORMAT_NAMES, "html");
  const { id, meta, result } = loadRun(context.openStore(), params.run);
  const report = render(result, format, {}, { isTty: false });
  const body = format === "text" ? `${describeRun(meta)}\n\n${report}` : report;
  const { type, extension } = downloadFor(format);
  return new Reply(200, null, { body, type, name: `builtcheck-${id}.${extension}` });
}

function compareRuns(context, _params, query) {
  const values = readQuery(query, ["before", "after", "limit"]);
  const { limit } = paging(values, 200, 5000);
  const store = context.openStore();
  const older = loadRun(store, values.before ?? "latest~1");
  const newer = loadRun(store, values.after ?? "latest");
  const before = entryFor(older.meta, older.result);
  const after = entryFor(newer.meta, newer.result);
  const changes = compareResults(older.result, newer.result);
  const notes = notesFor(before, after);
  if (older.id === newer.id) notes.unshift("Both names lead to the same run, so nothing can have changed.");
  return {
    before,
    after,
    notes,
    limit,
    summary: changes.summary,
    rules: changes.rules,
    added: changes.added.slice(0, limit),
    gone: changes.gone.slice(0, limit),
    still: changes.still.slice(0, limit),
  };
}

function listRules(_context, _params, query) {
  readQuery(query, []);
  return { rules: allRules.map(describeRule) };
}

function showRule(_context, params, query) {
  readQuery(query, []);
  const rule = allRules.find((candidate) => candidate.id === params.rule);
  if (!rule) throw new HttpError(404, `There is no rule ${params.rule.slice(0, 80)}. GET /api/rules lists them.`);
  return { rule: describeRule(rule) };
}

function auditStatus(context, _params, query) {
  readQuery(query, []);
  return context.audits.status();
}

async function startAudit(context, _params, query, request) {
  readQuery(query, []);
  const body = parseJsonObject(await readBody(request), ["label"]);
  if (body.label !== undefined && body.label !== null && typeof body.label !== "string") throw new HttpError(400, "label must be text.");
  return new Reply(202, context.audits.start(body.label === "" ? null : body.label));
}

// What a handler returns for anything but 200 with a JSON body: another status, or a file.
export class Reply {
  constructor(status, body, download = null) {
    this.status = status;
    this.body = body;
    this.download = download;
  }
}

// Each route: its method, a pattern for the path after /api, and its handler. A handler returns
// the JSON body, or a Reply.
const ROUTES = [
  ["GET", /^\/?$/, [], serverInfo],
  ["GET", /^\/store$/, [], storeInfo],
  ["GET", /^\/runs$/, [], listRuns],
  ["GET", /^\/runs\/([^/]+)$/, ["run"], showRun],
  ["GET", /^\/runs\/([^/]+)\/findings$/, ["run"], listFindings],
  ["GET", /^\/runs\/([^/]+)\/groups$/, ["run"], listGroups],
  ["GET", /^\/runs\/([^/]+)\/report$/, ["run"], downloadReport],
  ["GET", /^\/compare$/, [], compareRuns],
  ["GET", /^\/rules$/, [], listRules],
  ["GET", /^\/rules\/([^/]+\/[^/]+)$/, ["rule"], showRule],
  ["GET", /^\/audit$/, [], auditStatus],
  ["POST", /^\/audit$/, [], startAudit],
];

function decoded(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    throw new HttpError(400, "The path is not validly encoded.");
  }
}

// Finds the route for a path under /api and runs it. `path` is what follows /api.
export async function handleApi(context, method, path, query, request) {
  const candidates = ROUTES.map(([routeMethod, pattern, names, handler]) => ({ routeMethod, match: pattern.exec(path), names, handler })).filter((route) => route.match);
  if (candidates.length === 0) throw new HttpError(404, `There is no API route ${path.slice(0, 80)}. See docs/web.md for the routes.`);
  const route = candidates.find((candidate) => candidate.routeMethod === (method === "HEAD" ? "GET" : method));
  if (!route) {
    const allow = [...new Set(candidates.map((candidate) => candidate.routeMethod))].join(", ");
    throw new HttpError(405, `${path} takes ${allow} requests, not ${method}.`, { Allow: allow });
  }
  if (route.routeMethod === "POST") context.checkChange(request);
  const params = Object.fromEntries(route.names.map((name, index) => [name, decoded(route.match[index + 1])]));
  const answer = await route.handler(context, params, query, request);
  return answer instanceof Reply ? answer : new Reply(200, answer);
}
