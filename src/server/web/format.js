// Formatting and the state of a page's filters, kept apart from the document so they can be
// tested in Node. A run page's filters live in its address, so a filtered view can be bookmarked,
// shared and returned to with the Back button.

export const PAGE_SIZE = 100;

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

const two = (number) => String(number).padStart(2, "0");

// A time in the viewer's time zone, to the minute.
export function localTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function shortDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

// "index.html:14:3", or just the file for a finding about a whole file.
export function location(finding) {
  if (finding.line === null || finding.line === undefined) return finding.file;
  return `${finding.file}:${finding.line}${finding.column === null || finding.column === undefined ? "" : `:${finding.column}`}`;
}

export function signed(change) {
  return change === 0 ? "0" : change > 0 ? `+${change}` : `${change}`;
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

export function ruleGroup(id) {
  return id.split("/")[0];
}

// How a run is named: its id, and its label if it has one.
export function runName(entry) {
  return entry.label ? `${entry.id} (${entry.label})` : entry.id;
}

export function gitText(git) {
  if (!git) return "";
  const branch = git.branch ? `branch ${git.branch}` : "detached HEAD";
  return git.commit ? `${branch} at ${git.commit.slice(0, 12)}` : branch;
}

// "1 to 100 of 345"
export function range(offset, shown, total) {
  if (total === 0) return "none";
  return `${offset + 1} to ${offset + shown} of ${total}`;
}

// The ways a run page can show its findings.
export const VIEWS = ["list", "file", "rule", "group"];
export const SEVERITIES = ["", "error", "warning"];
export const SORTS = ["position", "severity", "rule", "message"];

const DEFAULTS = { view: "list", severity: "", group: "", rule: "", file: "", q: "", sort: "position", order: "asc", page: 1 };

// The filters of a run page from its address. Values that are not allowed fall back to the
// default rather than failing, since an address may be typed or old.
export function readRunState(search) {
  const params = new URLSearchParams(search);
  const get = (name) => params.get(name) ?? DEFAULTS[name];
  const pick = (name, choices) => (choices.includes(get(name)) ? get(name) : DEFAULTS[name]);
  const pageNumber = Number(params.get("page"));
  return {
    view: pick("view", VIEWS),
    severity: pick("severity", SEVERITIES),
    group: get("group").slice(0, 100),
    rule: get("rule").slice(0, 200),
    file: get("file"),
    q: get("q").slice(0, 200),
    sort: pick("sort", SORTS),
    order: pick("order", ["asc", "desc"]),
    page: Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1,
  };
}

// The address query for a state, leaving out what is at its default, so addresses stay short.
export function runStateSearch(state) {
  const params = new URLSearchParams();
  for (const [name, fallback] of Object.entries(DEFAULTS)) {
    const value = state[name];
    if (value !== undefined && value !== fallback && value !== "") params.set(name, String(value));
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

// The same state with some values changed. A change to anything but the page goes back to page 1.
export function withState(state, changes) {
  return { ...state, page: 1, ...changes };
}

function filterParams(state) {
  const params = new URLSearchParams();
  for (const name of ["severity", "group", "rule", "file", "q"]) {
    if (state[name]) params.set(name, state[name]);
  }
  return params;
}

// The API request for what a state shows: a page of findings, or the groups of the view.
export function apiPath(runId, state, pageSize = PAGE_SIZE) {
  const params = filterParams(state);
  const base = `/api/runs/${encodeURIComponent(runId)}`;
  if (state.view === "list") {
    if (state.sort !== "position") params.set("sort", state.sort);
    if (state.order !== "asc") params.set("order", state.order);
    params.set("offset", String((state.page - 1) * pageSize));
    params.set("limit", String(pageSize));
    return `${base}/findings?${params}`;
  }
  params.set("by", state.view);
  params.set("offset", String((state.page - 1) * pageSize));
  params.set("limit", String(pageSize));
  return `${base}/groups?${params}`;
}

// Where a group of a grouped view leads: the list of its findings.
export function groupState(state, view, key) {
  if (view === "file") return withState(state, { view: "list", file: key });
  if (view === "rule") return withState(state, { view: "list", rule: key });
  return withState(state, { view: "list", group: key, rule: "" });
}

// Words for what the filters keep, such as "errors in links rules matching menu".
export function describeFilter(state) {
  const parts = [];
  if (state.rule) parts.push(`of ${state.rule}`);
  else if (state.group) parts.push(`of ${state.group} rules`);
  if (state.file) parts.push(`in ${state.file}`);
  if (state.q) parts.push(`matching "${state.q}"`);
  const what = state.severity === "error" ? "Errors" : state.severity === "warning" ? "Warnings" : "Findings";
  return [what, ...parts].join(" ");
}

export function hasFilter(state) {
  return Boolean(state.severity || state.group || state.rule || state.file || state.q);
}

// The state after a filter control changed, from the form's values. `changed` names the control.
export function stateFromForm(state, values, changed) {
  const next = withState(state, {
    severity: values.severity ?? "",
    group: values.group ?? "",
    rule: values.rule ?? "",
    file: (values.file ?? "").trim(),
    q: values.q ?? "",
    view: values.view ?? state.view,
    sort: values.sort ?? state.sort,
    order: values.order ?? state.order,
  });
  // A rule and a rule group that disagree would match nothing, so the newer choice wins.
  if (next.rule && next.group && ruleGroup(next.rule) !== next.group) {
    if (changed === "group") next.rule = "";
    else next.group = "";
  }
  return readRunState(runStateSearch(next));
}

// The two runs the compare page starts with. `runs` is newest first. Without a choice in the
// address, the later run is the newest and the earlier one the run before the later one.
export function compareChoice(runs, search) {
  const params = new URLSearchParams(search);
  const after = params.get("after") ?? runs[0]?.id ?? null;
  const at = runs.findIndex((run) => run.id === after);
  const before = params.get("before") ?? (at >= 0 ? runs[at + 1]?.id : null) ?? null;
  return { before, after };
}
