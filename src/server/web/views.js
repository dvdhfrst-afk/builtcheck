// What each page shows, as HTML built from API answers. Pure functions of their data, so they can
// be tested in Node; app.js puts them in the document and wires up the controls.

import { trendChart } from "./chart.js";
import { html } from "./html.js";
import { bytes, describeFilter, gitText, groupState, hasFilter, localTime, location, PAGE_SIZE, plural, range, ruleGroup, runName, runStateSearch, signed } from "./format.js";

const runPath = (id, search = "") => `/runs/${encodeURIComponent(id)}${search}`;
const rulePath = (id) => `/rules/${id.split("/").map(encodeURIComponent).join("/")}`;

function option(value, label, current) {
  return html`<option value="${value}"${value === current ? html` selected` : ""}>${label}</option>`;
}

function severityBadge(severity) {
  return html`<span class="badge ${severity === "error" ? "error" : "warning"}">${severity}</span>`;
}

export function messagePage(title, message, links = []) {
  return html`<h1 tabindex="-1">${title}</h1><p class="notice">${message}</p>${links.length > 0 ? html`<ul class="links">${links.map(([href, text]) => html`<li><a href="${href}">${text}</a></li>`)}</ul>` : ""}`;
}

export function loading(what) {
  return html`<p class="loading">Loading ${what}</p>`;
}

// ---- Runs

// What the audit panel says about the audit running or the last one, changed in place as an
// audit runs so the form keeps its focus.
export function auditLine(status) {
  const job = status.audit;
  let line = html`<p class="muted">Runs the same audit as builtcheck ${status.site} --save, with the config file as it is now, and saves the run here.</p>`;
  if (status.running) line = html`<p class="running">Auditing ${status.site}, started ${localTime(job.startedAt)}.</p>`;
  else if (job?.state === "finished") line = html`<p class="done">The last audit finished: ${plural(job.errors, "error")}, ${plural(job.warnings, "warning")}${job.complete ? "" : ", incomplete"}. <a href="${runPath(job.run)}">See run ${job.run}</a>.</p>`;
  else if (job?.state === "failed") line = html`<p class="failed">The last audit failed: ${job.message}</p>`;
  const messages = job?.messages?.length > 0 ? html`<ul class="messages">${job.messages.map((message) => html`<li>${message}</li>`)}</ul>` : "";
  return html`${line}${messages}`;
}

export function problemLine(message) {
  return html`<p class="failed">${message}</p>`;
}

export function auditPanel(status) {
  if (!status?.enabled) return html``;
  return html`<section class="panel" aria-labelledby="audit-title">
<h2 id="audit-title">Audit ${status.site}</h2>
<form id="audit-form" class="inline">
<label>Label <input name="label" type="text" maxlength="80" placeholder="optional, such as release-2.4" autocomplete="off"></label>
<button type="submit"${status.running ? html` disabled` : ""}>${status.running ? "Auditing" : "Audit now"}</button>
</form>
<div id="audit-line">${auditLine(status)}</div>
</section>`;
}

function pager(offset, shown, total, pageSize, hrefFor) {
  if (total <= pageSize) return html``;
  const pageNumber = Math.floor(offset / pageSize) + 1;
  const pages = Math.ceil(total / pageSize);
  const previous = pageNumber > 1 ? html`<a href="${hrefFor(pageNumber - 1)}" rel="prev">Previous</a>` : html`<span class="off">Previous</span>`;
  const next = pageNumber < pages ? html`<a href="${hrefFor(pageNumber + 1)}" rel="next">Next</a>` : html`<span class="off">Next</span>`;
  return html`<nav class="pager" aria-label="Pages">${previous} <span>Page ${pageNumber} of ${pages}, ${range(offset, shown, total)}</span> ${next}</nav>`;
}

export const RUNS_PAGE_SIZE = 25;

export function runsPage({ list, trend, audit, store }) {
  const rows = list.runs.map((run, index) => {
    const older = list.runs[index + 1] ?? null;
    const compare = older || list.offset + index + 1 < list.total ? html`<a href="/compare?after=${encodeURIComponent(run.id)}">with the run before</a>` : "";
    return html`<tr>
<th scope="row"><a href="${runPath(run.id)}">${run.id}</a>${run.label ? html` <span class="label">${run.label}</span>` : ""}</th>
<td>${localTime(run.ranAt)}</td>
<td class="number${run.errors > 0 ? " error" : ""}">${run.errors}</td>
<td class="number${run.warnings > 0 ? " warning" : ""}">${run.warnings}</td>
<td class="number">${run.pages}</td>
<td>${run.complete ? "complete" : html`<span class="badge warning">incomplete</span>`}</td>
<td class="path">${run.folder ?? ""}</td>
<td>${gitText(run.git)}</td>
<td>${compare}</td>
</tr>`;
  });
  const unreadable = list.unreadable?.length > 0
    ? html`<div class="notice" role="note"><p>${plural(list.unreadable.length, "run")} could not be read. builtcheck store verify checks every run.</p><ul>${list.unreadable.map(({ reason }) => html`<li>${reason}</li>`)}</ul></div>`
    : "";
  const body = list.total === 0
    ? html`<p class="empty">No runs are saved in ${list.store} yet. Save one with builtcheck &lt;folder&gt; --save${audit?.enabled ? ", or audit the site above" : ""}.</p>`
    : html`<section aria-labelledby="trend-heading"><h2 id="trend-heading">Trend</h2>${trendChart(trend)}</section>
<section aria-labelledby="runs-heading"><h2 id="runs-heading">${plural(list.total, "run")}, newest first</h2>
<div class="scroll"><table class="runs">
<thead><tr><th scope="col">Run</th><th scope="col">Date</th><th scope="col" class="number">Errors</th><th scope="col" class="number">Warnings</th><th scope="col" class="number">Pages</th><th scope="col">Status</th><th scope="col">Folder</th><th scope="col">Git</th><th scope="col">Compare</th></tr></thead>
<tbody>${rows}</tbody></table></div>
${pager(list.offset, list.runs.length, list.total, RUNS_PAGE_SIZE, (number) => (number === 1 ? "/" : `/?page=${number}`))}
</section>`;
  const about = store?.exists
    ? html`<p class="scope">The results store ${store.path}, store format ${store.storeVersion}${store.current ? "" : ", older than this builtcheck writes"}, ${bytes(store.bytes)}.</p>`
    : "";
  return html`<h1 tabindex="-1">Saved runs</h1>
${about}
<div id="audit-panel">${auditPanel(audit)}</div>
${unreadable}${body}`;
}

// ---- One run

function card(count, word, kind = "") {
  return html`<div class="total ${kind}"><b>${count}</b>${word}</div>`;
}

function runFacts(run, meta) {
  const git = gitText(meta.git);
  return html`<p class="scope">Audited ${localTime(meta.ranAt)}${meta.folder ? html` of <code>${meta.folder}</code>` : ""} by builtcheck ${meta.toolVersion ?? "of an unknown version"}${git ? `, ${git}` : ""}${meta.source !== "audit" ? html`. Imported from ${meta.file ?? "a report file"}` : ""}.</p>`;
}

function filterForm(runId, state, facets) {
  const groups = facets.groups.map((group) => option(group.key, `${group.key} (${group.findings})`, state.group));
  const known = new Set(facets.rules.map((rule) => rule.key));
  const ruleOptions = [...facets.groups.map((group) => html`<optgroup label="${group.key}">${facets.rules.filter((rule) => ruleGroup(rule.key) === group.key).map((rule) => option(rule.key, `${rule.key} (${rule.findings})`, state.rule))}</optgroup>`)];
  // A rule named in the address with no findings in this run still shows as chosen.
  if (state.rule && !known.has(state.rule)) ruleOptions.push(option(state.rule, `${state.rule} (0)`, state.rule));
  if (state.group && !facets.groups.some((group) => group.key === state.group)) groups.push(option(state.group, `${state.group} (0)`, state.group));
  return html`<form id="filters" class="filters" role="search" aria-label="Filter findings">
<label>Severity <select name="severity">${option("", "All", state.severity)}${option("error", "Errors", state.severity)}${option("warning", "Warnings", state.severity)}</select></label>
<label>Rule group <select name="group">${option("", "All", state.group)}${groups}</select></label>
<label>Rule <select name="rule">${option("", "All", state.rule)}${ruleOptions}</select></label>
<label>File <input name="file" type="text" value="${state.file}" placeholder="exact path, such as index.html" autocomplete="off" spellcheck="false"></label>
<label>Search <input name="q" type="search" value="${state.q}" placeholder="message, file or rule" autocomplete="off"></label>
<label>Show <select name="view">${option("list", "Every finding", state.view)}${option("file", "Counts by file", state.view)}${option("rule", "Counts by rule", state.view)}${option("group", "Counts by rule group", state.view)}</select></label>
<label>Sort <select name="sort"${state.view === "list" ? "" : html` disabled`}>${option("position", "File and line", state.sort)}${option("severity", "Severity", state.sort)}${option("rule", "Rule", state.sort)}${option("message", "Message", state.sort)}</select></label>
<label>Order <select name="order"${state.view === "list" ? "" : html` disabled`}>${option("asc", "Ascending", state.order)}${option("desc", "Descending", state.order)}</select></label>
<button type="submit">Apply</button>
${hasFilter(state) ? html`<a href="${runPath(runId, runStateSearch({ view: state.view }))}">Clear filters</a>` : ""}
</form>`;
}

export function runPage({ detail, state, formats }) {
  const { run, meta, result, facets } = detail;
  const { summary } = result;
  const neighbours = [
    detail.previous ? html`<a href="${runPath(detail.previous)}" rel="prev">Previous run</a>` : "",
    detail.next ? html`<a href="${runPath(detail.next)}" rel="next">Next run</a>` : "",
    detail.previous ? html`<a href="/compare?before=${encodeURIComponent(detail.previous)}&amp;after=${encodeURIComponent(run.id)}">Compare with the previous run</a>` : "",
  ].filter(Boolean);
  const skipped = result.skipped.length > 0
    ? html`<details class="skipped"${result.complete ? "" : html` open`}><summary>Not covered by this audit <small>${result.skipped.length}</small></summary><ul>${result.skipped.map(({ file, reason }) => html`<li><code>${file}</code>: ${reason}</li>`)}</ul></details>`
    : "";
  const download = html`<form class="download inline" method="get" action="/api/runs/${encodeURIComponent(run.id)}/report">
<label>Report format <select name="format">${formats.map((format) => option(format.name, `${format.name}: ${format.description}`, "html"))}</select></label>
<button type="submit">Download</button>
</form>`;
  return html`<h1 tabindex="-1">Run ${run.id}${run.label ? html` <span class="label">${run.label}</span>` : ""}</h1>
${runFacts(run, meta)}
${neighbours.length > 0 ? html`<p class="links">${neighbours.map((link, index) => html`${index > 0 ? " | " : ""}${link}`)}</p>` : ""}
<div class="totals">
${card(summary.errors, summary.errors === 1 ? "error" : "errors", summary.errors ? "error" : "ok")}
${card(summary.warnings, summary.warnings === 1 ? "warning" : "warnings", summary.warnings ? "warning" : "ok")}
${card(summary.pages, summary.pages === 1 ? "page" : "pages")}
${card(summary.stylesheets, summary.stylesheets === 1 ? "stylesheet" : "stylesheets")}
${card(summary.files, summary.files === 1 ? "file" : "files")}
${card(summary.suppressed, "ignored inline")}
</div>
${result.complete ? "" : html`<p class="notice">This run is incomplete: some files could not be read or a rule failed, so its findings are not the whole story.</p>`}
${skipped}
${download}
<section aria-labelledby="findings-heading"><h2 id="findings-heading">Findings</h2>
${run.errors + run.warnings === 0 ? html`<p class="clean">No problems found.</p>` : html`${filterForm(run.id, state, facets)}<div id="results"></div>`}
</section>`;
}

function findingRows(findings) {
  return findings.map((finding) => html`<tr class="${finding.severity === "error" ? "error" : "warning"}">
<td class="at">${location(finding)}</td>
<td>${severityBadge(finding.severity)}</td>
<td class="message">${finding.message}</td>
<td class="rule"><a href="${rulePath(finding.rule)}">${finding.rule}</a></td>
</tr>`);
}

export function findingsTable(findings, caption) {
  return html`<div class="scroll"><table class="findings"><caption class="sr-only">${caption}</caption>
<thead><tr><th scope="col">Where</th><th scope="col">Severity</th><th scope="col">Message</th><th scope="col">Rule</th></tr></thead>
<tbody>${findingRows(findings)}</tbody></table></div>`;
}

const GROUP_NAMES = { file: "File", rule: "Rule", group: "Rule group" };

// The findings or groups that match a run page's filters. `data` is the answer of the API path
// apiPath() gives for the state.
export function resultsView(runId, state, data) {
  const hrefFor = (number) => runPath(runId, runStateSearch({ ...state, page: number }));
  const what = describeFilter(state);
  if (state.view === "list") {
    const heading = html`<h3 id="results-heading" tabindex="-1">${what}: ${range(data.offset, data.findings.length, data.total)}</h3>`;
    if (data.total === 0) return html`${heading}<p class="empty">Nothing matches these filters.</p>`;
    return html`${heading}${findingsTable(data.findings, what)}${pager(data.offset, data.findings.length, data.total, PAGE_SIZE, hrefFor)}`;
  }
  const heading = html`<h3 id="results-heading" tabindex="-1">${what} by ${GROUP_NAMES[state.view].toLowerCase()}: ${plural(data.findings, "finding")} in ${plural(data.total, GROUP_NAMES[state.view].toLowerCase())}</h3>`;
  if (data.total === 0) return html`${heading}<p class="empty">Nothing matches these filters.</p>`;
  const rows = data.groups.map((group) => html`<tr>
<th scope="row"><a href="${runPath(runId, runStateSearch(groupState(state, state.view, group.key)))}">${group.key}</a>${state.view === "rule" ? html` <a class="about" href="${rulePath(group.key)}">about this rule</a>` : ""}</th>
<td class="number${group.errors > 0 ? " error" : ""}">${group.errors}</td>
<td class="number${group.warnings > 0 ? " warning" : ""}">${group.warnings}</td>
<td class="number">${group.findings}</td>
</tr>`);
  return html`${heading}<div class="scroll"><table class="groups"><caption class="sr-only">${what} by ${GROUP_NAMES[state.view].toLowerCase()}</caption>
<thead><tr><th scope="col">${GROUP_NAMES[state.view]}</th><th scope="col" class="number">Errors</th><th scope="col" class="number">Warnings</th><th scope="col" class="number">Findings</th></tr></thead>
<tbody>${rows}</tbody></table></div>${pager(data.offset, data.groups.length, data.total, PAGE_SIZE, hrefFor)}`;
}

// ---- Compare

export function comparePage({ runs, before, after }) {
  const choices = (current) => runs.map((run) => option(run.id, `${runName(run)}, ${localTime(run.ranAt)}, ${plural(run.errors, "error")}`, current));
  return html`<h1 tabindex="-1">Compare runs</h1>
${runs.length < 2
    ? html`<p class="empty">Comparing needs two saved runs, and the store holds ${plural(runs.length, "run")}.</p>`
    : html`<form id="compare-form" class="filters">
<label>Earlier run <select name="before">${choices(before)}</select></label>
<label>Later run <select name="after">${choices(after)}</select></label>
<button type="submit">Compare</button>
</form>
<div id="comparison"></div>`}`;
}

function changeList(title, id, findings, total) {
  if (total === 0) return html``;
  const more = total > findings.length ? html`<p class="muted">The first ${findings.length} of ${total} are shown. GET /api/compare with a higher limit lists more.</p>` : "";
  return html`<section aria-labelledby="${id}"><h2 id="${id}">${title} <small>${total}</small></h2>${findingsTable(findings, title)}${more}</section>`;
}

export function comparisonView(data) {
  const { summary } = data;
  const row = (name, key) => html`<tr><th scope="row">${name}</th><td class="number">${summary.before[key]}</td><td class="number">${summary.after[key]}</td><td class="number">${signed(summary.after[key] - summary.before[key])}</td></tr>`;
  const severity = summary.severityChanged > 0 ? `, ${summary.severityChanged} of them with a different severity` : "";
  const rules = data.rules.length > 0
    ? html`<section aria-labelledby="rule-changes"><h2 id="rule-changes">Changes by rule</h2><div class="scroll"><table class="groups">
<thead><tr><th scope="col">Rule</th><th scope="col" class="number">Before</th><th scope="col" class="number">After</th><th scope="col" class="number">New</th><th scope="col" class="number">Gone</th></tr></thead>
<tbody>${data.rules.map((entry) => html`<tr><th scope="row"><a href="${rulePath(entry.rule)}">${entry.rule}</a></th><td class="number">${entry.before}</td><td class="number">${entry.after}</td><td class="number">${entry.added}</td><td class="number">${entry.gone}</td></tr>`)}</tbody></table></div></section>`
    : "";
  return html`<h2>Run ${runName(data.before)} compared with run ${runName(data.after)}</h2>
<div class="scroll"><table class="groups"><thead><tr><th scope="col"></th><th scope="col" class="number">Before</th><th scope="col" class="number">After</th><th scope="col" class="number">Change</th></tr></thead>
<tbody>${row("Errors", "errors")}${row("Warnings", "warnings")}${row("Pages", "pages")}</tbody></table></div>
<p>${summary.added} new, ${summary.gone} gone, ${summary.still} still present${severity}.</p>
${data.notes.length > 0 ? html`<div class="notice" role="note"><p>Notes</p><ul>${data.notes.map((note) => html`<li>${note}</li>`)}</ul></div>` : ""}
${changeList(`New in ${data.after.id}`, "added-heading", data.added, summary.added)}
${changeList(`Gone since ${data.before.id}`, "gone-heading", data.gone, summary.gone)}
${rules}`;
}

// ---- Rules

function optionsBlock(options) {
  const names = Object.keys(options ?? {});
  if (names.length === 0) return html`<p class="muted">No options.</p>`;
  return html`<dl class="options">${names.map((name) => html`<dt><code>${name}</code></dt><dd><code>${JSON.stringify(options[name])}</code></dd>`)}</dl>`;
}

export function rulesPage(rules) {
  const groups = new Map();
  for (const rule of rules) {
    if (!groups.has(rule.group)) groups.set(rule.group, []);
    groups.get(rule.group).push(rule);
  }
  const contents = [...groups.keys()].map((group) => html`<li><a href="#group-${group}">${group}</a> <small>${groups.get(group).length}</small></li>`);
  const sections = [...groups].map(([group, members]) => html`<section aria-labelledby="group-${group}"><h2 id="group-${group}">${group}</h2>
${members.map((rule) => html`<article class="rule"><h3><a href="${rulePath(rule.id)}">${rule.id}</a> ${severityBadge(rule.severity)}</h3><p>${rule.description}</p></article>`)}
</section>`);
  return html`<h1 tabindex="-1">Rules</h1>
<p class="scope">${plural(rules.length, "rule")} in ${plural(groups.size, "group")}. Each shows its default severity; a config file can change it or turn the rule off.</p>
<nav aria-label="Rule groups"><ul class="contents">${contents}</ul></nav>
${sections}`;
}

export function rulePage(rule) {
  return html`<p class="links"><a href="/rules">All rules</a></p>
<h1 tabindex="-1">${rule.id}</h1>
<p>Default severity: ${severityBadge(rule.severity)}</p>
<p class="description">${rule.description}</p>
<h2>Options and their defaults</h2>
${optionsBlock(rule.options)}
<h2>Changing it</h2>
<p>To turn it off, or to change its severity or options, add it to "rules" in builtcheck.config.json, such as <code>"rules": { "${rule.id}": "off" }</code>. The rule is documented in ${rule.docs} in the builtcheck package.</p>
<p class="links"><a href="${runPath("latest", runStateSearch({ rule: rule.id }))}">Its findings in the latest run</a></p>`;
}
