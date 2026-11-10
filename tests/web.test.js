// The browser modules of builtcheck serve, tested in Node: escaping, the state a run page keeps
// in its address, formatting, the trend chart, and every view given hostile site text.

import assert from "node:assert/strict";
import { test } from "node:test";
import { axisTop, chartPoints, trendChart, trendSummary } from "../src/server/web/chart.js";
import {
  apiPath, bytes, compareChoice, describeFilter, gitText, groupState, localTime, location, plural, range, readRunState, runStateSearch, signed, stateFromForm, withState,
} from "../src/server/web/format.js";
import { escapeHtml, html, raw } from "../src/server/web/html.js";
import { auditLine, auditPanel, comparePage, comparisonView, messagePage, resultsView, rulePage, rulesPage, runPage, runsPage } from "../src/server/web/views.js";

const HOSTILE_FILE = 'x"><img src=x onerror=alert(1)>.html';
const HOSTILE_MESSAGE = "</td><script>alert('x')</script>";
const HOSTILE_LABEL = '<b onmouseover="alert(1)">release</b>';

// Markup a hostile value could only have produced if it was not escaped.
function assertSafe(output) {
  const text = String(output);
  assert.ok(!text.includes("<script"), "no script element");
  assert.ok(!text.includes("<img"), "no img element");
  assert.ok(!text.includes("<b onmouseover"), "no label markup");
  // Quoted attribute values may hold escaped text; outside them, no tag may carry a handler.
  for (const tag of text.match(/<[a-z][^>]*>/gi) ?? []) {
    assert.doesNotMatch(tag.replace(/"[^"]*"/g, '""'), /\son\w+=/i, tag);
  }
  return text;
}

const finding = (rule, severity, file, line, message) => ({ rule, severity, file, line, column: line === null ? null : 3, message });

const RUN = { id: "20261103-100000-000", ranAt: "2026-11-03T10:00:00.000Z", label: HOSTILE_LABEL, folder: "<dist>", toolVersion: "1.0.0", source: "audit", errors: 1, warnings: 1, pages: 3, complete: true, git: { branch: "<main>", commit: "3f2c9a7d41b0e8c6f5a2" } };

// ---- Escaping

test("html escapes every value, in text and in attributes, and keeps html it is given", () => {
  const value = `<a href="x">'&'</a>`;
  assert.equal(escapeHtml(value), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(String(html`<p title="${value}">${value}</p>`), `<p title="${escapeHtml(value)}">${escapeHtml(value)}</p>`);
  assert.equal(String(html`<ul>${["<a>", raw("<li>b</li>"), html`<li>${"&"}</li>`]}</ul>`), "<ul>&lt;a&gt;<li>b</li><li>&amp;</li></ul>");
  assert.equal(String(html`${null}${undefined}${false}${0}`), "0");
});

test("control characters and direction overrides in site text are shown as escapes", () => {
  assert.equal(String(html`${"evil\u202Elmth.exe"}`), "evil\\u202elmth.exe");
  assert.equal(String(html`${"line\u001b[2Jone"}`), "line\\u001b[2Jone");
  assert.equal(String(html`<p>${"a\nb"}</p>`), "<p>a\\u000ab</p>");
});

// ---- A run page's state

test("a run page's state is read from its address, with bad values falling back to defaults", () => {
  assert.deepEqual(readRunState(""), { view: "list", severity: "", group: "", rule: "", file: "", q: "", sort: "position", order: "asc", page: 1 });
  const state = readRunState("?view=rule&severity=error&group=links&rule=links/broken-internal&file=a%20b.html&q=menu&sort=message&order=desc&page=3");
  assert.deepEqual(state, { view: "rule", severity: "error", group: "links", rule: "links/broken-internal", file: "a b.html", q: "menu", sort: "message", order: "desc", page: 3 });
  assert.deepEqual(readRunState("?view=table&severity=fatal&sort=size&order=up&page=-2"), readRunState(""));
  assert.equal(readRunState("?page=1.5").page, 1);
  assert.equal(readRunState(`?q=${"a".repeat(500)}`).q.length, 200);
});

test("the address leaves out defaults and survives a round trip", () => {
  assert.equal(runStateSearch(readRunState("")), "");
  assert.equal(runStateSearch({ ...readRunState(""), severity: "warning", page: 2 }), "?severity=warning&page=2");
  const search = "?view=file&severity=error&file=blog%2Findex.html&q=a%26b";
  assert.deepEqual(readRunState(runStateSearch(readRunState(search))), readRunState(search));
  assert.equal(readRunState(runStateSearch({ q: "a&b=c#d" })).q, "a&b=c#d");
});

test("the API path for a state asks for a page of findings or of groups", () => {
  const state = readRunState("?severity=error&q=menu&sort=rule&order=desc&page=3");
  assert.equal(apiPath("latest~1", state), "/api/runs/latest~1/findings?severity=error&q=menu&sort=rule&order=desc&offset=200&limit=100");
  assert.equal(apiPath("20261103-100000-000", readRunState(""), 25), "/api/runs/20261103-100000-000/findings?offset=0&limit=25");
  assert.equal(apiPath("x", readRunState("?view=rule&group=links&sort=message")), "/api/runs/x/groups?group=links&by=rule&offset=0&limit=100");
  assert.equal(apiPath("x", readRunState("?file=a%26b.html")), "/api/runs/x/findings?file=a%26b.html&offset=0&limit=100");
});

test("changing a filter goes back to page 1, and a rule and group that disagree keep the newer", () => {
  const state = readRunState("?group=links&page=4");
  assert.equal(withState(state, { severity: "error" }).page, 1);
  const values = { severity: "", group: "links", rule: "copy/em-dash", file: " index.html ", q: "", view: "list", sort: "position", order: "asc" };
  const ruleChosen = stateFromForm(state, values, "rule");
  assert.deepEqual([ruleChosen.group, ruleChosen.rule, ruleChosen.file, ruleChosen.page], ["", "copy/em-dash", "index.html", 1]);
  const groupChosen = stateFromForm(state, values, "group");
  assert.deepEqual([groupChosen.group, groupChosen.rule], ["links", ""]);
  const agreeing = stateFromForm(state, { ...values, rule: "links/broken-internal" }, "rule");
  assert.deepEqual([agreeing.group, agreeing.rule], ["links", "links/broken-internal"]);
  // Sort and order are disabled in a grouped view, so the form leaves them out.
  const grouped = stateFromForm(readRunState("?sort=rule"), { view: "file" }, "view");
  assert.deepEqual([grouped.view, grouped.sort], ["file", "rule"]);
});

test("a group of a grouped view leads to the list of its findings", () => {
  const state = readRunState("?view=file&severity=error&page=2");
  assert.deepEqual(groupState(state, "file", "a.html"), { ...state, view: "list", file: "a.html", page: 1 });
  assert.equal(groupState(state, "rule", "links/broken-internal").rule, "links/broken-internal");
  const group = groupState({ ...state, rule: "copy/em-dash" }, "group", "links");
  assert.deepEqual([group.group, group.rule], ["links", ""]);
});

test("the filter is described in words", () => {
  assert.equal(describeFilter(readRunState("")), "Findings");
  assert.equal(describeFilter(readRunState("?severity=error&group=links&file=a.html&q=menu")), 'Errors of links rules in a.html matching "menu"');
  assert.equal(describeFilter(readRunState("?severity=warning&group=links&rule=links/broken-internal")), "Warnings of links/broken-internal");
});

test("the compare page starts with the newest run and the one before it, or the runs named", () => {
  const runs = [{ id: "c" }, { id: "b" }, { id: "a" }];
  assert.deepEqual(compareChoice(runs, ""), { before: "b", after: "c" });
  assert.deepEqual(compareChoice(runs, "?after=b"), { before: "a", after: "b" });
  assert.deepEqual(compareChoice(runs, "?after=a"), { before: null, after: "a" });
  assert.deepEqual(compareChoice(runs, "?before=a&after=c"), { before: "a", after: "c" });
  assert.deepEqual(compareChoice([], ""), { before: null, after: null });
});

// ---- Formatting

test("small formatting helpers", () => {
  assert.equal(plural(1, "run"), "1 run");
  assert.equal(plural(0, "run"), "0 runs");
  assert.equal(location({ file: "a.html", line: 3, column: 7 }), "a.html:3:7");
  assert.equal(location({ file: "a.html", line: 3, column: null }), "a.html:3");
  assert.equal(location({ file: "a.html", line: null, column: null }), "a.html");
  assert.deepEqual([signed(0), signed(4), signed(-2)], ["0", "+4", "-2"]);
  assert.deepEqual([bytes(512), bytes(2048), bytes(5 * 1024 * 1024)], ["512 bytes", "2.0 KB", "5.0 MB"]);
  assert.equal(gitText({ branch: "main", commit: "3f2c9a7d41b0e8c6f5a2d9b1" }), "branch main at 3f2c9a7d41b0");
  assert.equal(gitText({ branch: null, commit: null }), "detached HEAD");
  assert.equal(gitText(null), "");
  assert.deepEqual([range(0, 100, 345), range(300, 45, 345), range(0, 0, 0)], ["1 to 100 of 345", "301 to 345 of 345", "none"]);
  assert.equal(localTime("not a time"), "unknown");
  assert.match(localTime("2026-11-03T10:00:00.000Z"), /^2026-11-0[23] \d\d:\d\d$/);
});

// ---- The trend chart

const trend = (pairs) => pairs.map(([errors, warnings], index) => ({ id: `2026110${index + 1}-100000-000`, ranAt: `2026-11-0${index + 1}T10:00:00.000Z`, label: null, errors, warnings }));

test("the chart's axis tops out at a round number", () => {
  assert.deepEqual([0, 3, 4, 5, 9, 15, 23, 99, 101, 240, 1234].map(axisTop), [4, 4, 4, 5, 10, 20, 25, 100, 200, 250, 2000]);
});

test("the chart sums up the trend in words", () => {
  assert.equal(trendSummary([]), "No runs saved yet.");
  assert.equal(trendSummary(trend([[2, 1]])), "One run, with 2 errors and 1 warning.");
  assert.equal(trendSummary(trend([[15, 14], [4, 3], [0, 3]])), "Over the last 3 runs, errors went down from 15 to 0, and warnings went down from 14 to 3.");
  assert.equal(trendSummary(trend([[15, 2], [0, 2], [15, 2]])), "Over the last 3 runs, errors are back at 15, having ranged from 0 to 15, and warnings stayed at 2.");
  assert.equal(trendSummary(trend([[0, 0], [3, 1]])), "Over the last 2 runs, errors went up from 0 to 3, and warnings went up from 0 to 1.");
});

test("the chart places runs left to right, oldest first, and counts bottom to top", () => {
  const points = chartPoints(trend([[0, 0], [5, 0], [10, 0]]), "errors", 10);
  assert.deepEqual(points.map((point) => point.x), [40, 332, 624]);
  assert.ok(points[0].y > points[1].y && points[1].y > points[2].y);
  assert.deepEqual(chartPoints(trend([[3, 0]]), "errors", 4).map((point) => point.x), [332]);
});

test("the chart is inline SVG with a text alternative, and escapes labels", () => {
  assert.equal(String(trendChart([])), "");
  const runs = trend([[4, 2], [1, 2]]);
  runs[1].label = HOSTILE_LABEL;
  const svg = assertSafe(trendChart(runs));
  assert.match(svg, /<svg viewBox="0 0 640 180" role="img" aria-labelledby="trend-title trend-desc"/);
  assert.match(svg, /<desc id="trend-desc">Over the last 2 runs, errors went down from 4 to 1/);
  assert.equal((svg.match(/<polyline/g) ?? []).length, 2);
  assert.equal((svg.match(/<circle/g) ?? []).length, 4);
  assert.ok(svg.includes("&lt;b onmouseover=&quot;alert(1)&quot;&gt;release&lt;/b&gt;"));
  assert.ok(!svg.includes("http://") && !svg.includes("https://"));
});

// ---- Views, given hostile text from a site

const DETAIL = {
  run: RUN,
  meta: { ...RUN, savedAt: RUN.ranAt, configDigest: null, resultDigest: null },
  result: { root: "<dist>", complete: false, summary: { errors: 1, warnings: 1, suppressed: 0, pages: 3, stylesheets: 1, files: 4 }, skipped: [{ file: HOSTILE_FILE, reason: HOSTILE_MESSAGE, incomplete: true }] },
  previous: "20261102-100000-000",
  next: null,
  facets: {
    groups: [{ key: "<links>", errors: 1, warnings: 0, findings: 1 }, { key: "style", errors: 0, warnings: 1, findings: 1 }],
    rules: [{ key: "<links>/x", errors: 1, warnings: 0, findings: 1 }, { key: "style/pure-color", errors: 0, warnings: 1, findings: 1 }],
    files: 2,
  },
};
const FORMATS = [{ name: "html", description: "One page" }, { name: "csv", description: "<rows>" }];

test("a run page escapes its label, folder, branch, skipped files and filter options", () => {
  const state = readRunState(`?file=${encodeURIComponent(HOSTILE_FILE)}&q=${encodeURIComponent(HOSTILE_MESSAGE)}&rule=${encodeURIComponent("<x>/y")}`);
  const page = assertSafe(runPage({ detail: DETAIL, state, formats: FORMATS }));
  assert.ok(page.includes("&lt;b onmouseover=&quot;alert(1)&quot;&gt;release&lt;/b&gt;"));
  assert.ok(page.includes("<code>&lt;dist&gt;</code>"));
  assert.ok(page.includes("branch &lt;main&gt; at 3f2c9a7d41b0"));
  assert.ok(page.includes(`value="${escapeHtml(HOSTILE_FILE)}"`));
  assert.ok(page.includes(`value="${escapeHtml(HOSTILE_MESSAGE)}"`));
  assert.ok(page.includes('<option value="&lt;x&gt;/y" selected>&lt;x&gt;/y (0)</option>'));
  assert.ok(page.includes("This run is incomplete"));
  assert.ok(page.includes("<details class=\"skipped\" open>"));
  assert.ok(page.includes('action="/api/runs/20261103-100000-000/report"'));
  assert.ok(page.includes('<option value="html" selected>html: One page</option>'));
  assert.ok(page.includes('href="/compare?before=20261102-100000-000&amp;after=20261103-100000-000"'));
  assert.ok(page.includes('<div id="results"></div>'));
  assert.ok(page.includes('<label>Search <input name="q" type="search"'));
});

test("a run with nothing found says so instead of showing filters", () => {
  const clean = { ...DETAIL, run: { ...RUN, errors: 0, warnings: 0 }, result: { ...DETAIL.result, complete: true, skipped: [] } };
  const page = String(runPage({ detail: clean, state: readRunState(""), formats: FORMATS }));
  assert.ok(page.includes("No problems found."));
  assert.ok(!page.includes('id="filters"'));
  assert.ok(!page.includes("incomplete"));
});

test("findings are listed escaped, each linking to its rule", () => {
  const data = { offset: 0, total: 2, findings: [finding("style/pure-color", "warning", HOSTILE_FILE, 2, HOSTILE_MESSAGE), finding("links/broken-internal", "error", "index.html", null, "Link /menu/ does not resolve")] };
  const out = assertSafe(resultsView(RUN.id, readRunState(""), data));
  assert.ok(out.includes(`<td class="at">${escapeHtml(HOSTILE_FILE)}:2:3</td>`));
  assert.ok(out.includes(`<td class="message">${escapeHtml(HOSTILE_MESSAGE)}</td>`));
  assert.ok(out.includes('<a href="/rules/style/pure-color">style/pure-color</a>'));
  assert.ok(out.includes('<span class="badge error">error</span>'));
  assert.match(out, /<h3 id="results-heading" tabindex="-1">Findings: 1 to 2 of 2<\/h3>/);
  assert.ok(!out.includes('class="pager"'));
});

test("long lists get a pager whose links keep the filters", () => {
  const data = { offset: 100, total: 250, findings: Array.from({ length: 100 }, (_, index) => finding("links/broken-internal", "error", "a.html", index + 1, "Broken")) };
  const out = String(resultsView(RUN.id, readRunState("?severity=error&page=2"), data));
  assert.ok(out.includes('<a href="/runs/20261103-100000-000?severity=error" rel="prev">Previous</a>'));
  assert.ok(out.includes('<a href="/runs/20261103-100000-000?severity=error&amp;page=3" rel="next">Next</a>'));
  assert.ok(out.includes("Page 2 of 3, 101 to 200 of 250"));
});

test("grouped views escape their keys and link each group to its findings", () => {
  const data = { offset: 0, total: 1, findings: 3, groups: [{ key: HOSTILE_FILE, errors: 2, warnings: 1, findings: 3 }] };
  const out = assertSafe(resultsView(RUN.id, readRunState("?view=file&severity=error"), data));
  assert.ok(out.includes(`href="/runs/${RUN.id}?${escapeHtml(new URLSearchParams({ severity: "error", file: HOSTILE_FILE }))}"`));
  assert.ok(out.includes(`>${escapeHtml(HOSTILE_FILE)}</a>`));
  assert.match(out, /Errors by file: 3 findings in 1 file/);
  const rules = String(resultsView(RUN.id, readRunState("?view=rule"), { offset: 0, total: 1, findings: 1, groups: [{ key: "links/broken-internal", errors: 1, warnings: 0, findings: 1 }] }));
  assert.ok(rules.includes('<a class="about" href="/rules/links/broken-internal">about this rule</a>'));
  assert.ok(rules.includes("?rule=links%2Fbroken-internal"));
  assert.ok(String(resultsView(RUN.id, readRunState("?view=group&q=zzz"), { offset: 0, total: 0, findings: 0, groups: [] })).includes("Nothing matches these filters."));
});

test("the runs page escapes labels and folders, and shows the chart and the audit panel", () => {
  const list = { store: "<store>", total: 2, offset: 0, runs: [RUN, { ...RUN, id: "20261102-100000-000", label: null, complete: false, git: null }], unreadable: [{ id: "20261101-100000-000", reason: HOSTILE_MESSAGE }] };
  const audit = { enabled: true, site: "<site>", running: false, audit: null };
  const store = { path: "<store>", exists: true, storeVersion: 2, current: true, bytes: 4096 };
  const out = assertSafe(runsPage({ list, trend: [...list.runs].reverse(), audit, store }));
  assert.ok(out.includes('<span class="label">&lt;b onmouseover=&quot;alert(1)&quot;&gt;release&lt;/b&gt;</span>'));
  assert.ok(out.includes('<td class="path">&lt;dist&gt;</td>'));
  assert.ok(out.includes("The results store &lt;store&gt;, store format 2, 4.0 KB."));
  assert.ok(out.includes("<h2 id=\"audit-title\">Audit &lt;site&gt;</h2>"));
  assert.ok(out.includes('<figure class="trend">'));
  assert.ok(out.includes("1 run could not be read"));
  assert.ok(out.includes('<a href="/compare?after=20261103-100000-000">with the run before</a>'));
  assert.ok(out.includes('<span class="badge warning">incomplete</span>'));
  const empty = String(runsPage({ list: { store: "<s>", total: 0, offset: 0, runs: [] }, trend: [], audit: { enabled: false } }));
  assert.ok(empty.includes("No runs are saved in &lt;s&gt; yet."));
  assert.ok(!empty.includes("audit-form"));
});

test("the audit panel shows a running, finished or failed audit, escaped", () => {
  const base = { enabled: true, site: "dist" };
  assert.equal(String(auditPanel({ enabled: false })), "");
  const running = String(auditPanel({ ...base, running: true, audit: { state: "running", startedAt: RUN.ranAt } }));
  assert.ok(running.includes("<button type=\"submit\" disabled>Auditing</button>"));
  const finished = String(auditLine({ ...base, running: false, audit: { state: "finished", run: RUN.id, errors: 1, warnings: 0, complete: true, messages: [] } }));
  assert.ok(finished.includes(`<a href="/runs/${RUN.id}">See run ${RUN.id}</a>`));
  const failed = assertSafe(auditLine({ ...base, running: false, audit: { state: "failed", message: HOSTILE_MESSAGE, messages: [HOSTILE_FILE] } }));
  assert.ok(failed.includes(escapeHtml(HOSTILE_MESSAGE)));
  assert.ok(failed.includes(`<li>${escapeHtml(HOSTILE_FILE)}</li>`));
});

test("the compare page offers the runs and shows changes escaped", () => {
  const runs = [RUN, { ...RUN, id: "20261102-100000-000", label: null }];
  const page = assertSafe(comparePage({ runs, before: "20261102-100000-000", after: RUN.id }));
  assert.ok(page.includes('<option value="20261102-100000-000" selected>'));
  assert.ok(page.includes(`<option value="${RUN.id}" selected>`));
  assert.ok(String(comparePage({ runs: [RUN], before: null, after: RUN.id })).includes("Comparing needs two saved runs"));
  const data = {
    before: { ...RUN, id: "20261102-100000-000", label: null },
    after: RUN,
    notes: [HOSTILE_MESSAGE],
    summary: { before: { errors: 3, warnings: 1, pages: 3 }, after: { errors: 1, warnings: 2, pages: 3 }, added: 1, gone: 2, still: 1, severityChanged: 0 },
    rules: [{ rule: "style/pure-color", before: 0, after: 1, added: 1, gone: 0 }],
    added: [finding("style/pure-color", "warning", HOSTILE_FILE, 2, HOSTILE_MESSAGE)],
    gone: [finding("links/broken-internal", "error", "index.html", 4, "Broken")],
    still: [],
  };
  const out = assertSafe(comparisonView(data));
  assert.ok(out.includes("<td class=\"number\">-2</td>"));
  assert.ok(out.includes("1 new, 2 gone, 1 still present."));
  assert.ok(out.includes(`<li>${escapeHtml(HOSTILE_MESSAGE)}</li>`));
  assert.ok(out.includes("The first 1 of 2 are shown."));
  assert.ok(out.includes('<a href="/rules/style/pure-color">style/pure-color</a>'));
});

test("the rules pages list rules by group and describe one with its options", () => {
  const rules = [
    { id: "links/broken-internal", group: "links", severity: "error", description: "Links that resolve to nothing.", options: {}, docs: "docs/rules/links.md" },
    { id: "copy/placeholder-text", group: "copy", severity: "error", description: "Template <text>.", options: { extraPatterns: ["<x>"] }, docs: "docs/rules/copy.md" },
  ];
  const list = assertSafe(rulesPage(rules));
  assert.ok(list.includes("2 rules in 2 groups."));
  assert.ok(list.includes('<h2 id="group-links">links</h2>'));
  assert.ok(list.includes("Template &lt;text&gt;."));
  const one = String(rulePage(rules[1]));
  assert.ok(one.includes('<h1 tabindex="-1">copy/placeholder-text</h1>'));
  assert.ok(one.includes("<dt><code>extraPatterns</code></dt><dd><code>[&quot;&lt;x&gt;&quot;]</code></dd>"));
  assert.ok(one.includes('<a href="/runs/latest?rule=copy%2Fplaceholder-text">'));
  assert.ok(String(rulePage(rules[0])).includes("No options."));
});

test("a message page escapes its message", () => {
  const out = assertSafe(messagePage("Not found", HOSTILE_MESSAGE, [["/", "Saved runs"]]));
  assert.ok(out.includes('<a href="/">Saved runs</a>'));
});
