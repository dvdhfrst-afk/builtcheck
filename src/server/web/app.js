// The browser side of builtcheck serve: reads the JSON API of the server that served it, and
// shows each page. Pages are real addresses, so links, bookmarks and the Back button work, and
// every control is a link, button or labelled field, so all of it works from the keyboard.
// Nothing here reaches any server but this one.

import { apiPath, compareChoice, readRunState, runStateSearch, stateFromForm } from "./format.js";
import * as views from "./views.js";

const main = document.getElementById("main");
const status = document.getElementById("status");
const token = document.querySelector('meta[name="builtcheck-token"]')?.getAttribute("content") ?? "";

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Every request goes to this server's own API, by a path.
async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, credentials: "same-origin", headers: { Accept: "application/json", ...(options.headers ?? {}) } });
  } catch {
    throw new ApiError(0, "The builtcheck server did not answer. It may have stopped: start it again with builtcheck serve.");
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error?.message ?? `The server answered with status ${response.status}.`);
  return body;
}

function show(content) {
  main.innerHTML = String(content);
}

function announce(text) {
  status.textContent = text;
}

let serverInfo = null;
async function info() {
  if (!serverInfo) serverInfo = await api("/api");
  return serverInfo;
}

// Each navigation takes a ticket, so an answer that arrives after the user has moved on is dropped.
let ticket = 0;
// The run page on screen, so a change of its filters only fetches the findings again.
let shownRun = null;

function navigate(address, { replace = false, focus = true } = {}) {
  if (replace) history.replaceState(null, "", address);
  else history.pushState(null, "", address);
  route({ focus });
}

async function route({ focus = true } = {}) {
  const mine = (ticket += 1);
  const path = location.pathname;
  const current = () => mine === ticket;
  try {
    if (/^\/runs\/[^/]+$/.test(path)) {
      if (shownRun?.path === path) {
        syncFilters(readRunState(location.search));
        await showResults(current, focus);
        return;
      }
      shownRun = null;
      await showRun(decodeURIComponent(path.slice("/runs/".length)), current);
    } else {
      shownRun = null;
      if (path === "/") await showRuns(current);
      else if (path === "/compare") await showCompare(current);
      else if (path === "/rules") await showRules(current);
      else if (/^\/rules\/[^/]+\/[^/]+$/.test(path)) await showRule(path.slice("/rules/".length), current);
      else {
        document.title = "Not found | builtcheck";
        show(views.messagePage("Page not found", "There is nothing at this address.", [["/", "Saved runs"], ["/rules", "Rules"]]));
      }
    }
  } catch (error) {
    if (!current()) return;
    shownRun = null;
    document.title = "Problem | builtcheck";
    show(views.messagePage(error.code === 404 ? "Not found" : "Something went wrong", error.message, [["/", "Saved runs"]]));
  }
  if (focus && current()) main.querySelector("h1")?.focus();
}

// ---- Runs

const RUNS_PAGE_SIZE = views.RUNS_PAGE_SIZE;
const TREND_RUNS = 60;

async function showRuns(current) {
  const pageNumber = Math.max(1, Math.floor(Number(new URLSearchParams(location.search).get("page"))) || 1);
  show(views.loading("the saved runs"));
  const [list, trend, audit, store] = await Promise.all([
    api(`/api/runs?offset=${(pageNumber - 1) * RUNS_PAGE_SIZE}&limit=${RUNS_PAGE_SIZE}`),
    api(`/api/runs?limit=${TREND_RUNS}`),
    api("/api/audit"),
    api("/api/store"),
  ]);
  if (!current()) return;
  document.title = "Saved runs | builtcheck";
  show(views.runsPage({ list, trend: [...trend.runs].reverse(), audit, store: store.store }));
  wireAudit();
  if (audit.running) watchAudit();
}

function showAudit(state) {
  const line = document.getElementById("audit-line");
  if (line) line.innerHTML = String(views.auditLine(state));
  const button = document.querySelector("#audit-form button");
  if (button) {
    button.disabled = state.running;
    button.textContent = state.running ? "Auditing" : "Audit now";
  }
}

function wireAudit() {
  const form = document.getElementById("audit-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const label = form.elements.label.value.trim();
    try {
      const started = await api("/api/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Builtcheck-Token": token },
        body: JSON.stringify(label ? { label } : {}),
      });
      showAudit(started);
      announce("The audit has started. This page shows the run when it finishes.");
      watchAudit();
    } catch (error) {
      announce(error.message);
      const line = document.getElementById("audit-line");
      if (line) line.innerHTML = String(views.problemLine(error.message));
    }
  });
}

// Asks how the audit is going every second until it ends, then shows the new run if the runs
// page is still open, and says how it went either way.
let watching = null;
function watchAudit() {
  if (watching) return;
  watching = setInterval(async () => {
    let state;
    try {
      state = await api("/api/audit");
    } catch (error) {
      clearInterval(watching);
      watching = null;
      announce(error.message);
      return;
    }
    if (state.running) return;
    clearInterval(watching);
    watching = null;
    const job = state.audit;
    showAudit(state);
    if (job?.state === "finished") {
      announce(`The audit finished with ${job.errors} errors and ${job.warnings} warnings, saved as run ${job.run}.`);
      if (location.pathname === "/") navigate(`/runs/${encodeURIComponent(job.run)}`);
    } else {
      announce(`The audit failed: ${job?.message ?? "no reason was given."}`);
    }
  }, 1000);
}

// ---- One run

async function showRun(name, current) {
  show(views.loading(`run ${name}`));
  const [detail, server] = await Promise.all([api(`/api/runs/${encodeURIComponent(name)}`), info()]);
  if (!current()) return;
  document.title = `Run ${detail.run.id} | builtcheck`;
  show(views.runPage({ detail, state: readRunState(location.search), formats: server.formats }));
  shownRun = { path: location.pathname, id: detail.run.id };
  wireFilters();
  await showResults(current, false);
}

async function showResults(current, focus) {
  const results = document.getElementById("results");
  if (!results || !shownRun) return;
  const state = readRunState(location.search);
  results.setAttribute("aria-busy", "true");
  const data = await api(apiPath(shownRun.id, state));
  if (!current()) return;
  results.innerHTML = String(views.resultsView(shownRun.id, state, data));
  results.removeAttribute("aria-busy");
  const heading = document.getElementById("results-heading");
  announce(heading?.textContent ?? "");
  if (focus) heading?.focus();
}

function formValues(form) {
  const values = {};
  for (const element of form.elements) {
    if (element.name && !element.disabled) values[element.name] = element.value;
  }
  return values;
}

// Puts the controls in step with the address, as after the Back button.
function syncFilters(state) {
  const form = document.getElementById("filters");
  if (!form) return;
  for (const name of ["severity", "group", "rule", "file", "q", "view", "sort", "order"]) {
    const element = form.elements[name];
    if (element && element.value !== state[name]) element.value = state[name];
  }
  form.elements.sort.disabled = state.view !== "list";
  form.elements.order.disabled = state.view !== "list";
}

function wireFilters() {
  const form = document.getElementById("filters");
  if (!form) return;
  let typing = null;
  const apply = (changed) => {
    clearTimeout(typing);
    const state = stateFromForm(readRunState(location.search), formValues(form), changed);
    syncFilters(state);
    const address = `${location.pathname}${runStateSearch(state)}`;
    if (address !== `${location.pathname}${location.search}`) navigate(address, { replace: true, focus: false });
  };
  form.addEventListener("change", (event) => {
    if (event.target.tagName === "SELECT") apply(event.target.name);
  });
  // Typing waits for a pause, so each key does not fetch.
  form.addEventListener("input", (event) => {
    if (event.target.tagName !== "INPUT") return;
    clearTimeout(typing);
    typing = setTimeout(() => apply(event.target.name), 300);
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    apply("submit");
  });
}

// ---- Compare

async function showCompare(current) {
  show(views.loading("the saved runs"));
  const list = await api("/api/runs?limit=500");
  if (!current()) return;
  const { before, after } = compareChoice(list.runs, location.search);
  document.title = "Compare runs | builtcheck";
  show(views.comparePage({ runs: list.runs, before, after }));
  const form = document.getElementById("compare-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const params = new URLSearchParams({ before: form.elements.before.value, after: form.elements.after.value });
    navigate(`/compare?${params}`, { focus: false });
  });
  if (!before || !after) return;
  const target = document.getElementById("comparison");
  target.setAttribute("aria-busy", "true");
  const data = await api(`/api/compare?${new URLSearchParams({ before, after })}`);
  if (!current()) return;
  target.innerHTML = String(views.comparisonView(data));
  target.removeAttribute("aria-busy");
  announce(`${data.summary.added} new, ${data.summary.gone} gone, ${data.summary.still} still present.`);
}

// ---- Rules

async function showRules(current) {
  const { rules } = await api("/api/rules");
  if (!current()) return;
  document.title = "Rules | builtcheck";
  show(views.rulesPage(rules));
}

async function showRule(id, current) {
  const { rule } = await api(`/api/rules/${id}`);
  if (!current()) return;
  document.title = `${rule.id} | builtcheck`;
  show(views.rulePage(rule));
}

// Links within the page change the page without loading it again. Links to the API, such as a
// report download, and links that open elsewhere are left to the browser.
document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (link.origin !== location.origin || link.target || link.hasAttribute("download")) return;
  if (link.pathname.startsWith("/api/") || link.pathname.startsWith("/static/")) return;
  if (link.hash && link.pathname === location.pathname && link.search === location.search) return;
  event.preventDefault();
  navigate(`${link.pathname}${link.search}`);
});

window.addEventListener("popstate", () => route({ focus: true }));

route({ focus: false });
