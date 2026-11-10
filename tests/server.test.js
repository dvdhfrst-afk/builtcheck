// builtcheck serve: the JSON API, the page and its files, the security checks, audits started
// through the API, and the command itself. Every server listens on port 0 on the loopback address.

import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/cli.js";
import { COMMANDS } from "../src/commands/index.js";
import { allRules } from "../src/rules/index.js";
import { startServer } from "../src/server/index.js";
import { allowedHosts, bindAddress, isLoopback } from "../src/server/security.js";
import { Store } from "../src/store/store.js";
import { page } from "./helpers.js";

function inTemp(fn) {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-server-"));
  return Promise.resolve()
    .then(() => fn(folder))
    .finally(() => rmSync(folder, { recursive: true, force: true }));
}

function finding(rule, severity, file, line, message) {
  return { rule, severity, file, line, column: line === null ? null : 1, message };
}

function result(findings, extra = {}) {
  const count = (severity) => findings.filter((item) => item.severity === severity).length;
  return {
    tool: "builtcheck",
    version: "1.0.0",
    resultVersion: 1,
    root: "site",
    site: { host: null, basePath: "/" },
    complete: true,
    summary: { errors: count("error"), warnings: count("warning"), suppressed: 0, pages: 3, stylesheets: 1, files: 5 },
    findings,
    skipped: [],
    ...extra,
  };
}

const HOSTILE_FILE = 'a"><img src=x onerror=alert(1)>.html';
const HOSTILE_MESSAGE = '</td><script>alert("x")</script>';

const FIRST = [
  finding("links/broken-internal", "error", "index.html", 4, "Link /menu/ does not resolve to any file in the build"),
  finding("links/broken-internal", "error", "about/index.html", 9, "Link /team/ does not resolve to any file in the build"),
  finding("copy/placeholder-text", "error", "index.html", 7, "Placeholder text (lorem ipsum): \"Lorem ipsum\""),
  finding("copy/duplicate-heading", "warning", "about/index.html", 12, "Heading \"Our ovens\" repeats the heading on line 10"),
  finding("schema/page-missing", "warning", "about/index.html", null, "Page has no JSON-LD structured data"),
];
const SECOND = [
  FIRST[1],
  { ...FIRST[3], line: 14 },
  FIRST[4],
  finding("style/pure-color", "warning", HOSTILE_FILE, 2, HOSTILE_MESSAGE),
];

const TIMES = ["2026-11-01T10:00:00.000Z", "2026-11-02T10:00:00.000Z", "2026-11-03T10:00:00.000Z"];
const IDS = ["20261101-100000-000", "20261102-100000-000", "20261103-100000-000"];

// A store of three runs: problems, the same problems, then some fixed and one new.
function makeStore(folder) {
  const path = join(folder, "store");
  const store = new Store(path, "store");
  store.add(result(FIRST), { ranAt: TIMES[0], label: "first", folder: "site", source: "audit" });
  store.add(result(FIRST), { ranAt: TIMES[1], label: null, folder: "site", source: "audit" });
  store.add(result(SECOND), { ranAt: TIMES[2], label: "<b>release</b>", folder: "site", source: "audit" });
  return path;
}

// One request with full control of the headers, which fetch() would not allow for Host.
function call(server, path, { method = "GET", headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const options = { host: "127.0.0.1", port: server.port, path, method, headers: { ...headers }, agent: false };
    if (host === null) options.setHost = false;
    else options.headers.Host = host ?? `127.0.0.1:${server.port}`;
    const outgoing = httpRequest(options, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          const json = text !== "" && (response.headers["content-type"] ?? "").startsWith("application/json") ? JSON.parse(text) : null;
          resolve({ status: response.statusCode, headers: response.headers, text, json });
        } catch (error) {
          reject(error);
        }
      });
    });
    outgoing.on("error", reject);
    if (body !== undefined) outgoing.write(body);
    outgoing.end();
  });
}

function post(server, path, body, headers = {}) {
  return call(server, path, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json", "X-Builtcheck-Token": server.token, ...headers } });
}

async function withServer(options, fn) {
  return inTemp(async (folder) => {
    const store = makeStore(folder);
    const server = await startServer({ store, storeShown: "store", port: 0, ...options(folder) });
    try {
      return await fn(server, folder);
    } finally {
      await server.close();
    }
  });
}

const plain = (fn) => withServer(() => ({}), fn);

// ---- The API

test("GET /api describes the server, its store and the report formats", () =>
  plain(async (server) => {
    const { status, json } = await call(server, "/api");
    assert.equal(status, 200);
    assert.equal(json.apiVersion, 1);
    assert.equal(json.tool, "builtcheck");
    assert.deepEqual(json.store, { path: "store", storeVersion: 2 });
    assert.deepEqual(json.audits, { enabled: false, site: null });
    assert.equal(json.formats.length, 10);
    assert.deepEqual(json.formats.find((format) => format.name === "sarif"), { name: "sarif", description: json.formats.find((format) => format.name === "sarif").description, extension: "sarif" });
  }));

test("runs are listed newest first, with paging", () =>
  plain(async (server) => {
    const all = await call(server, "/api/runs");
    assert.equal(all.json.total, 3);
    assert.deepEqual(all.json.runs.map((run) => run.id), [...IDS].reverse());
    assert.equal(all.json.runs[0].label, "<b>release</b>");
    assert.equal(all.json.runs[0].errors, 1);
    assert.equal(all.json.runs[0].warnings, 3);
    const second = await call(server, "/api/runs?offset=1&limit=1");
    assert.deepEqual([second.json.offset, second.json.limit, second.json.total], [1, 1, 3]);
    assert.deepEqual(second.json.runs.map((run) => run.id), [IDS[1]]);
    const past = await call(server, "/api/runs?offset=10");
    assert.deepEqual(past.json.runs, []);
  }));

test("bad paging and unknown parameters are 400 with a plain message", () =>
  plain(async (server) => {
    for (const path of ["/api/runs?limit=0", "/api/runs?limit=501", "/api/runs?limit=ten", "/api/runs?offset=-1", "/api/runs?colour=red", "/api/runs?limit=1&limit=2"]) {
      const { status, json } = await call(server, path);
      assert.equal(status, 400, path);
      assert.equal(json.error.status, 400);
      assert.equal(typeof json.error.message, "string");
    }
    assert.match((await call(server, "/api/runs?colour=red")).json.error.message, /Unknown parameter "colour"\. This route takes offset, limit/);
  }));

test("GET /api/store gives the store's format, size and runs", () =>
  plain(async (server) => {
    const { json } = await call(server, "/api/store");
    assert.equal(json.store.path, "store");
    assert.equal(json.store.exists, true);
    assert.equal(json.store.current, true);
    assert.equal(json.store.runs, 3);
    assert.ok(json.store.bytes > 0);
    assert.equal(json.store.oldest.id, IDS[0]);
    assert.equal(json.store.newest.id, IDS[2]);
  }));

test("a run is found by id, by the start of one, by latest and by latest~N", () =>
  plain(async (server) => {
    for (const [name, id] of [[IDS[1], IDS[1]], ["20261102", IDS[1]], ["latest", IDS[2]], ["latest~2", IDS[0]]]) {
      const { status, json } = await call(server, `/api/runs/${name}`);
      assert.equal(status, 200, name);
      assert.equal(json.run.id, id, name);
    }
    const { json } = await call(server, `/api/runs/${IDS[1]}`);
    assert.equal(json.previous, IDS[0]);
    assert.equal(json.next, IDS[2]);
    assert.equal(json.meta.folder, "site");
    assert.equal(json.result.summary.errors, 3);
    assert.equal(json.result.findings, undefined);
    assert.deepEqual(json.facets.groups.map((group) => [group.key, group.errors, group.warnings]), [["copy", 1, 1], ["links", 2, 0], ["schema", 0, 1]]);
    assert.equal(json.facets.files, 2);
  }));

test("an unknown run is 404, a name that is not a run name or names several is 400", () =>
  plain(async (server) => {
    const unknown = await call(server, "/api/runs/2099");
    assert.equal(unknown.status, 404);
    assert.match(unknown.json.error.message, /No run in store has an id starting "2099"/);
    assert.equal((await call(server, "/api/runs/latest~3")).status, 404);
    assert.equal((await call(server, "/api/runs/2026110")).status, 400);
    assert.equal((await call(server, "/api/runs/..%2Fstore")).status, 400);
    assert.equal((await call(server, "/api/runs/abc/findings")).status, 400);
    assert.equal((await call(server, "/api/runs/2099/report")).status, 404);
  }));

test("findings filter by severity, rule, rule group, file and text", () =>
  plain(async (server) => {
    const ids = async (query) => {
      const { status, json } = await call(server, `/api/runs/${IDS[0]}/findings${query}`);
      assert.equal(status, 200, query);
      return json.findings.map((item) => `${item.file}:${item.line}`);
    };
    assert.deepEqual(await ids(""), ["about/index.html:null", "about/index.html:9", "about/index.html:12", "index.html:4", "index.html:7"]);
    assert.deepEqual(await ids("?severity=warning"), ["about/index.html:null", "about/index.html:12"]);
    assert.deepEqual(await ids("?severity=error,warning&file=index.html"), ["index.html:4", "index.html:7"]);
    assert.deepEqual(await ids("?rule=links/broken-internal"), ["about/index.html:9", "index.html:4"]);
    assert.deepEqual(await ids("?rule=links/broken-internal,schema/page-missing&severity=warning"), ["about/index.html:null"]);
    assert.deepEqual(await ids("?group=copy"), ["about/index.html:12", "index.html:7"]);
    assert.deepEqual(await ids("?group=copy,schema&file=about/index.html"), ["about/index.html:null", "about/index.html:12"]);
    assert.deepEqual(await ids("?q=LOREM"), ["index.html:7"]);
    assert.deepEqual(await ids("?q=about%2F&severity=error"), ["about/index.html:9"]);
    assert.deepEqual(await ids("?q=duplicate-heading"), ["about/index.html:12"]);
    assert.deepEqual(await ids("?rule=links/nothing-like-this"), []);
    const { json } = await call(server, `/api/runs/${IDS[0]}/findings?severity=error&group=links`);
    assert.deepEqual(json.filter, { severity: ["error"], group: ["links"] });
    assert.equal(json.total, 2);
  }));

test("findings sort and page", () =>
  plain(async (server) => {
    const list = async (query) => (await call(server, `/api/runs/${IDS[0]}/findings${query}`)).json;
    assert.deepEqual((await list("?sort=severity")).findings.map((item) => item.severity), ["error", "error", "error", "warning", "warning"]);
    assert.deepEqual((await list("?sort=severity&order=desc")).findings.map((item) => item.severity), ["warning", "warning", "error", "error", "error"]);
    assert.deepEqual((await list("?sort=rule")).findings.map((item) => item.rule), ["copy/duplicate-heading", "copy/placeholder-text", "links/broken-internal", "links/broken-internal", "schema/page-missing"]);
    assert.equal((await list("?sort=message")).findings[0].message, "Heading \"Our ovens\" repeats the heading on line 10");
    const paged = await list("?sort=rule&offset=2&limit=2");
    assert.deepEqual([paged.total, paged.offset, paged.limit, paged.findings.length], [5, 2, 2, 2]);
    assert.deepEqual(paged.findings.map((item) => item.rule), ["links/broken-internal", "links/broken-internal"]);
  }));

test("bad finding filters are 400", () =>
  plain(async (server) => {
    for (const query of ["severity=fatal", "severity=", "sort=size", "order=up", "limit=1001", `q=${"a".repeat(201)}`, "file=", "rule=,", "by=file"]) {
      const { status, json } = await call(server, `/api/runs/latest/findings?${query}`);
      assert.equal(status, 400, query);
      assert.ok(json.error.message.length > 0);
    }
  }));

test("findings group by file, rule or rule group, with counts", () =>
  plain(async (server) => {
    const groups = async (query) => (await call(server, `/api/runs/${IDS[0]}/groups${query}`)).json;
    const byFile = await groups("");
    assert.equal(byFile.by, "file");
    assert.deepEqual(byFile.groups, [{ key: "index.html", errors: 2, warnings: 0, findings: 2 }, { key: "about/index.html", errors: 1, warnings: 2, findings: 3 }]);
    assert.deepEqual([byFile.total, byFile.findings], [2, 5]);
    const byRule = await groups("?by=rule&sort=name");
    assert.deepEqual(byRule.groups.map((group) => [group.key, group.findings]), [["copy/duplicate-heading", 1], ["copy/placeholder-text", 1], ["links/broken-internal", 2], ["schema/page-missing", 1]]);
    const byGroup = await groups("?by=group&severity=error");
    assert.deepEqual(byGroup.groups.map((group) => [group.key, group.errors]), [["links", 2], ["copy", 1]]);
    assert.equal((await groups("?by=rule&limit=1&offset=1")).groups.length, 1);
    assert.equal((await call(server, `/api/runs/${IDS[0]}/groups?by=page`)).status, 400);
    assert.equal((await call(server, `/api/runs/${IDS[0]}/groups?sort=position`)).status, 400);
  }));

test("compare reports new, gone and still present findings, latest~1 with latest by default", () =>
  plain(async (server) => {
    const { status, json } = await call(server, "/api/compare");
    assert.equal(status, 200);
    assert.equal(json.before.id, IDS[1]);
    assert.equal(json.after.id, IDS[2]);
    assert.deepEqual([json.summary.added, json.summary.gone, json.summary.still], [1, 2, 3]);
    assert.equal(json.added[0].message, HOSTILE_MESSAGE);
    assert.deepEqual(json.gone.map((item) => item.rule).sort(), ["copy/placeholder-text", "links/broken-internal"]);
    assert.deepEqual(json.rules.map((entry) => entry.rule), ["copy/placeholder-text", "links/broken-internal", "style/pure-color"]);
    assert.deepEqual(json.notes, []);
    const limited = await call(server, `/api/compare?before=${IDS[0]}&after=latest&limit=1`);
    assert.equal(limited.json.gone.length, 1);
    assert.equal(limited.json.summary.gone, 2);
    const same = await call(server, "/api/compare?before=latest&after=latest");
    assert.match(same.json.notes[0], /same run/);
    assert.equal((await call(server, "/api/compare?before=2099")).status, 404);
    assert.equal((await call(server, "/api/compare?then=latest")).status, 400);
  }));

test("the rules are listed with descriptions, default severities and options", () =>
  plain(async (server) => {
    const { json } = await call(server, "/api/rules");
    assert.equal(json.rules.length, allRules.length);
    const rule = json.rules.find((item) => item.id === "links/broken-internal");
    assert.equal(rule.group, "links");
    assert.equal(rule.severity, "error");
    assert.ok(rule.description.length > 10);
    assert.equal(rule.docs, "docs/rules/links.md");
    assert.ok(json.rules.some((item) => Object.keys(item.options).length > 0));
    const one = await call(server, "/api/rules/links/broken-internal");
    assert.deepEqual(one.json.rule, rule);
    assert.equal((await call(server, "/api/rules/links/no-such-rule")).status, 404);
  }));

test("a saved run downloads in every format, with its content type and a file name", () =>
  plain(async (server) => {
    const expected = {
      html: ["text/html", "html"],
      json: ["application/json", "json"],
      csv: ["text/csv", "csv"],
      sarif: ["application/sarif+json", "sarif"],
      junit: ["application/xml", "xml"],
      checkstyle: ["application/xml", "xml"],
      markdown: ["text/markdown", "md"],
      text: ["text/plain", "txt"],
      github: ["text/plain", "txt"],
      codeclimate: ["application/json", "json"],
    };
    for (const [format, [type, extension]] of Object.entries(expected)) {
      const { status, headers, text } = await call(server, `/api/runs/latest/report?format=${format}`);
      assert.equal(status, 200, format);
      assert.equal(headers["content-type"], `${type}; charset=utf-8`, format);
      assert.equal(headers["content-disposition"], `attachment; filename="builtcheck-${IDS[2]}.${extension}"`, format);
      assert.ok(text.length > 0, format);
    }
    const json = JSON.parse((await call(server, `/api/runs/${IDS[0]}/report?format=json`)).text);
    assert.equal(json.findings.length, 5);
    const text = (await call(server, "/api/runs/latest/report?format=text")).text;
    assert.match(text, new RegExp(`^Run ${IDS[2]} \\(<b>release</b>\\) of site, audited `));
    const html = (await call(server, "/api/runs/latest/report")).text;
    assert.ok(html.includes("&lt;/td&gt;&lt;script&gt;"));
    assert.ok(!html.includes(HOSTILE_MESSAGE));
    assert.equal((await call(server, "/api/runs/latest/report?format=pdf")).status, 400);
  }));

test("a damaged run file is a 500 with the reason, and the other runs still read", () =>
  plain(async (server, folder) => {
    writeFileSync(join(folder, "store", "runs", `${IDS[1]}.json`), "{ not json");
    const { status, json } = await call(server, `/api/runs/${IDS[1]}`);
    assert.equal(status, 500);
    assert.match(json.error.message, /Run 20261102-100000-000/);
    assert.equal((await call(server, `/api/runs/${IDS[2]}`)).status, 200);
  }));

test("runs saved while the server runs are seen at once", () =>
  plain(async (server, folder) => {
    new Store(join(folder, "store"), "store").add(result([]), { ranAt: "2026-11-04T10:00:00.000Z", folder: "site", source: "audit" });
    const { json } = await call(server, "/api/runs");
    assert.equal(json.total, 4);
    assert.equal(json.runs[0].errors, 0);
  }));

test("an empty or missing store lists no runs and finds none", () =>
  inTemp(async (folder) => {
    const server = await startServer({ store: join(folder, "none"), storeShown: "none", port: 0 });
    try {
      const { json } = await call(server, "/api/runs");
      assert.deepEqual([json.total, json.storeVersion, json.runs], [0, null, []]);
      assert.equal((await call(server, "/api/store")).json.store.exists, false);
      const latest = await call(server, "/api/runs/latest");
      assert.equal(latest.status, 404);
      assert.match(latest.json.error.message, /There are no runs in none yet/);
    } finally {
      await server.close();
    }
  }));

test("unknown API routes are 404 and other methods are 405 with the methods allowed", () =>
  plain(async (server) => {
    assert.equal((await call(server, "/api/everything")).status, 404);
    const put = await call(server, "/api/runs", { method: "PUT" });
    assert.equal(put.status, 405);
    assert.equal(put.headers.allow, "GET");
    const audit = await call(server, "/api/audit", { method: "DELETE" });
    assert.equal(audit.status, 405);
    assert.equal(audit.headers.allow, "GET, POST");
    const page = await call(server, "/", { method: "POST" });
    assert.equal(page.status, 405);
    const head = await call(server, "/api/runs", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
  }));

// ---- The page and its files

test("every response carries the security headers, and none carries CORS headers", () =>
  plain(async (server) => {
    for (const path of ["/", "/api/runs", "/api/runs/latest/report?format=html", "/static/server/web/app.js", "/api/nothing", "/nothing"]) {
      const { headers } = await call(server, path, { headers: { Origin: "https://www.example.com" } });
      assert.equal(headers["x-content-type-options"], "nosniff", path);
      assert.equal(headers["referrer-policy"], "no-referrer", path);
      assert.match(headers["content-security-policy"], /frame-ancestors 'none'/, path);
      assert.equal(headers["cache-control"], "no-store", path);
      assert.equal(headers["cross-origin-resource-policy"], "same-origin", path);
      assert.ok(!Object.keys(headers).some((name) => name.startsWith("access-control-")), path);
    }
    const page = await call(server, "/");
    assert.match(page.headers["content-security-policy"], /default-src 'none'; script-src 'self'; style-src 'self'/);
    assert.ok(!page.headers["content-security-policy"].includes("unsafe"));
    assert.match((await call(server, "/api/runs")).headers["content-security-policy"], /sandbox/);
  }));

test("the page is served for its own paths, with the token, and with 404 elsewhere", () =>
  plain(async (server) => {
    for (const path of ["/", "/compare", "/rules", "/rules/links/broken-internal", `/runs/${IDS[0]}`, "/runs/latest?view=file"]) {
      const { status, headers, text } = await call(server, path);
      assert.equal(status, 200, path);
      assert.equal(headers["content-type"], "text/html; charset=utf-8");
      assert.ok(text.includes(`<meta name="builtcheck-token" content="${server.token}">`), path);
      assert.ok(text.includes('<script type="module" src="/static/server/web/app.js"></script>'));
    }
    assert.match(server.token, /^[0-9a-f]{64}$/);
    assert.equal((await call(server, "/nothing/here")).status, 404);
    assert.ok(!/https?:\/\//.test((await call(server, "/")).text), "the page loads nothing from elsewhere");
  }));

test("only the browser's own files are served, never the store, the site or other source", () =>
  plain(async (server) => {
    const script = await call(server, "/static/server/web/app.js");
    assert.equal(script.status, 200);
    assert.equal(script.headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal((await call(server, "/static/report/printable.js")).status, 200);
    assert.equal((await call(server, "/static/server/web/style.css")).headers["content-type"], "text/css; charset=utf-8");
    for (const path of ["/static/server/index.js", "/static/cli.js", "/static/../package.json", "/static/server/web/%2e%2e/index.js", "/static/server/web/../security.js", "/store/index.json", `/store/runs/${IDS[0]}.json`, "/static/", "/package.json"]) {
      const { status, text } = await call(server, path);
      assert.equal(status, 404, path);
      assert.ok(!text.includes("storeVersion") && !text.includes("import "), path);
    }
  }));

test("folder names in the page are escaped", () =>
  inTemp(async (folder) => {
    const server = await startServer({ store: join(folder, "store"), storeShown: '<script>alert("store")</script>', site: "site\"><img src=x onerror=alert(1)>", port: 0 });
    try {
      const { text } = await call(server, "/");
      assert.ok(!text.includes("<script>alert"));
      assert.ok(!text.includes("<img"));
      assert.ok(text.includes("&lt;script&gt;alert(&quot;store&quot;)&lt;/script&gt;"));
      assert.ok(text.includes("site&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"));
    } finally {
      await server.close();
    }
  }));

test("hostile file names and messages come back from the API as data, unchanged", () =>
  plain(async (server) => {
    const { headers, json } = await call(server, `/api/runs/latest/findings?file=${encodeURIComponent(HOSTILE_FILE)}`);
    assert.equal(headers["content-type"], "application/json; charset=utf-8");
    assert.equal(json.findings.length, 1);
    assert.equal(json.findings[0].message, HOSTILE_MESSAGE);
    assert.equal(json.findings[0].file, HOSTILE_FILE);
  }));

// ---- Security checks

test("a request for another host name is refused, which blocks DNS rebinding", () =>
  plain(async (server) => {
    for (const host of ["attacker.example.com", `attacker.example.com:${server.port}`, "127.0.0.1", `127.0.0.1:${server.port + 1}`, `localhost.example.com:${server.port}`]) {
      const { status, json } = await call(server, "/api/runs", { host });
      assert.equal(status, 403, host);
      assert.match(json.error.message, /does not answer to the host name/);
    }
    for (const host of [`localhost:${server.port}`, `LOCALHOST:${server.port}`, `127.0.0.1:${server.port}`]) {
      assert.equal((await call(server, "/api/runs", { host })).status, 200, host);
    }
    assert.equal((await call(server, "/", { host: "attacker.example.com" })).status, 403);
    assert.equal((await call(server, "/api/runs", { host: null })).status, 400);
  }));

test("the hosts a server answers to follow the address it is bound to", () => {
  assert.deepEqual([...allowedHosts("127.0.0.1", 7750)].sort(), ["127.0.0.1:7750", "localhost:7750"]);
  assert.deepEqual([...allowedHosts("::1", 7750)].sort(), ["[::1]:7750", "localhost:7750"]);
  assert.deepEqual([...allowedHosts("192.0.2.10", 7750)], ["192.0.2.10:7750"]);
  assert.ok(allowedHosts("127.0.0.1", 80).has("localhost"));
  const wildcard = allowedHosts("0.0.0.0", 7750);
  assert.ok(wildcard.has("127.0.0.1:7750") && wildcard.has("localhost:7750"));
  assert.ok(!wildcard.has("attacker.example.com:7750"));
  assert.deepEqual(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0", "10.0.0.5", "fe80::1", "256.1.1.1", "example.com", "1.2.3"].map(bindAddress), ["127.0.0.1", "127.0.0.1", "::1", "::1", "0.0.0.0", "10.0.0.5", "fe80::1", null, null, null]);
  assert.deepEqual(["127.0.0.1", "127.8.0.1", "::1", "0.0.0.0", "10.0.0.5", "::"].map(isLoopback), [true, true, true, false, false, false]);
});

test("POST needs JSON, the server's token and no foreign origin", () =>
  plain(async (server) => {
    const missing = await call(server, "/api/audit", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } });
    assert.equal(missing.status, 403);
    assert.match(missing.json.error.message, /token/);
    assert.equal((await post(server, "/api/audit", {}, { "X-Builtcheck-Token": "0".repeat(64) })).status, 403);
    assert.equal((await post(server, "/api/audit", {}, { "X-Builtcheck-Token": server.token.slice(1) })).status, 403);
    const form = await post(server, "/api/audit", "label=x", { "Content-Type": "application/x-www-form-urlencoded" });
    assert.equal(form.status, 415);
    assert.equal((await post(server, "/api/audit", {}, { "Content-Type": "text/plain" })).status, 415);
    const foreign = await post(server, "/api/audit", {}, { Origin: "https://attacker.example.com" });
    assert.equal(foreign.status, 403);
    assert.match(foreign.json.error.message, /another site/);
    // Every check passed, and this server has no site, so audits are off.
    const own = await post(server, "/api/audit", {}, { Origin: `http://127.0.0.1:${server.port}`, "Content-Type": "application/json; charset=utf-8" });
    assert.equal(own.status, 403);
    assert.match(own.json.error.message, /without --site/);
  }));

test("a request body over the limit is refused", () =>
  plain(async (server) => {
    const big = await post(server, "/api/audit", JSON.stringify({ label: "x".repeat(20000) }));
    assert.equal(big.status, 413);
    assert.match(big.json.error.message, /over 16384 bytes/);
  }));

// ---- Audits through the API

// A site with one broken link, and a config that runs only the link rules.
function auditSetup(folder) {
  const site = join(folder, "site");
  mkdirSync(site);
  writeFileSync(join(site, "index.html"), page('<a href="/menu/">Menu</a>'));
  const config = join(folder, "builtcheck.config.json");
  writeFileSync(config, JSON.stringify({ rules: { "*": "off", "links/*": "error" } }));
  return { site, config };
}

async function finished(server) {
  for (let tries = 0; tries < 200; tries += 1) {
    const { json } = await call(server, "/api/audit");
    if (!json.running) return json;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("the audit did not finish");
}

test("an audit started through the API runs, is saved in the store, and is shown when it finishes", () =>
  withServer((folder) => ({ ...auditSetup(folder), cwd: folder }), async (server, folder) => {
    const before = await call(server, "/api/audit");
    assert.deepEqual([before.json.enabled, before.json.running, before.json.audit], [true, false, null]);
    assert.equal(before.json.site, join(folder, "site"));
    const started = await post(server, "/api/audit", { label: "from-the-page" });
    assert.equal(started.status, 202);
    assert.equal(started.json.running, true);
    assert.equal(started.json.audit.state, "running");
    assert.equal(started.json.audit.label, "from-the-page");
    const done = await finished(server);
    assert.equal(done.audit.state, "finished", done.audit.message);
    assert.deepEqual([done.audit.errors, done.audit.warnings, done.audit.complete], [1, 0, true]);
    const run = await call(server, `/api/runs/${done.audit.run}`);
    assert.equal(run.json.run.label, "from-the-page");
    assert.equal(run.json.meta.folder, join(folder, "site"));
    assert.equal(run.json.meta.source, "audit");
    assert.equal((await call(server, "/api/runs/latest")).json.run.id, done.audit.run);
    const findings = await call(server, "/api/runs/latest/findings");
    assert.deepEqual(findings.json.findings.map((item) => item.rule), ["links/broken-internal"]);
  }));

test("an audit that cannot run says why, and saves nothing", () =>
  withServer((folder) => ({ ...auditSetup(folder), cwd: folder }), async (server, folder) => {
    rmSync(join(folder, "site"), { recursive: true });
    assert.equal((await post(server, "/api/audit", {})).status, 202);
    const done = await finished(server);
    assert.equal(done.audit.state, "failed");
    assert.match(done.audit.message, /Folder not found/);
    assert.equal((await call(server, "/api/runs")).json.total, 3);
  }));

test("a config file made invalid after the server started fails the audit with its message", () =>
  withServer((folder) => ({ ...auditSetup(folder), cwd: folder }), async (server, folder) => {
    writeFileSync(join(folder, "builtcheck.config.json"), JSON.stringify({ rules: { "links/no-such-rule": "error" } }));
    await post(server, "/api/audit", {});
    const done = await finished(server);
    assert.equal(done.audit.state, "failed");
    assert.match(done.audit.message, /links\/no-such-rule/);
  }));

test("only one audit runs at a time, and a second request gets 409", () => {
  let release;
  const runner = () => ({ done: new Promise((resolve) => (release = resolve)), cancel: () => {} });
  return withServer((folder) => ({ ...auditSetup(folder), runner }), async (server) => {
    assert.equal((await post(server, "/api/audit", {})).status, 202);
    const second = await post(server, "/api/audit", {});
    assert.equal(second.status, 409);
    assert.match(second.json.error.message, /already running/);
    release({ ok: true, run: IDS[2], errors: 1, warnings: 3, complete: true, messages: [] });
    const done = await finished(server);
    assert.equal(done.audit.run, IDS[2]);
    assert.equal((await post(server, "/api/audit", {})).status, 202);
    release({ ok: false, message: "stopped", messages: [] });
    assert.equal((await finished(server)).audit.number, 2);
  });
});

test("a bad label or body is 400", () =>
  withServer((folder) => ({ ...auditSetup(folder), runner: () => ({ done: new Promise(() => {}), cancel: () => {} }) }), async (server) => {
    for (const body of ['{"label":"two\\nlines"}', `{"label":"${"x".repeat(81)}"}`, '{"label":5}', '{"folder":"/"}', "[1]", "{ nope"]) {
      const { status } = await post(server, "/api/audit", body);
      assert.equal(status, 400, body);
    }
  }));

// ---- The command

// Runs `builtcheck serve` through main() until it prints its address, then gives the address
// and a way to stop it as Ctrl+C would.
async function serving(argv) {
  let out = "";
  let err = "";
  const io = { stdout: (text) => (out += text), stderr: (text) => (err += text), isTty: false };
  const exit = Promise.resolve(main(["serve", ...argv], io));
  for (let tries = 0; tries < 200 && !/https?:\/\/\S+\//.test(out) && !err; tries += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const url = /(http:\/\/\S+\/)\n/.exec(out)?.[1];
  return {
    url,
    output: () => ({ out, err }),
    exit,
    stop: async () => {
      process.emit("SIGINT");
      return exit;
    },
  };
}

test("builtcheck serve prints its address, serves the store and stops cleanly on Ctrl+C", () =>
  inTemp(async (folder) => {
    makeStore(folder);
    const running = await serving(["--port", "0", "--store", join(folder, "store"), "--no-config"]);
    assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const port = Number(new URL(running.url).port);
    const { json } = await call({ port }, "/api/runs");
    assert.equal(json.total, 3);
    assert.equal(await running.stop(), 0);
    assert.match(running.output().out, /serving the results store .*store at http:\/\/127\.0\.0\.1:\d+\/\n.*press Ctrl\+C to stop\n.*stopped\n/s);
    assert.equal(running.output().err, "");
    assert.equal(process.listenerCount("SIGINT"), 0);
  }));

test("builtcheck serve with --site says the page can audit it", () =>
  inTemp(async (folder) => {
    const { site, config } = auditSetup(folder);
    const running = await serving(["--port", "0", "--store", join(folder, "store"), "--site", site, "--config", config]);
    assert.match(running.output().out, /the page can start audits of /);
    const port = Number(new URL(running.url).port);
    assert.equal((await call({ port }, "/api/audit")).json.enabled, true);
    assert.equal(await running.stop(), 0);
  }));

test("a port in use gives a plain error and exit code 2", () =>
  inTemp(async (folder) => {
    const other = await startServer({ store: join(folder, "store"), port: 0 });
    try {
      const running = await serving(["--port", String(other.port), "--store", join(folder, "store"), "--no-config"]);
      assert.equal(await running.exit, 2);
      assert.match(running.output().err, new RegExp(`^builtcheck: port ${other.port} on 127\\.0\\.0\\.1 is in use by another program\\. Choose another with --port, or --port 0 for any free port\\.\\n$`));
    } finally {
      await other.close();
    }
  }));

test("builtcheck serve refuses bad options before it starts", () =>
  inTemp(async (folder) => {
    const cases = [
      [["--port", "70000"], /--port must be from 0 to 65535/],
      [["--port", "http"], /--port needs a whole number/],
      [["--host", "example.com"], /--host must be an IP address/],
      [["--format", "json"], /has no --format/],
      [["somewhere"], /takes no folder/],
      [["--site", join(folder, "missing")], /Folder not found/],
      [["--site", folder, "--store", join(folder, "inside")], /inside the site folder/],
      [["--open-browser"], /Unknown option for builtcheck serve: --open-browser/],
    ];
    for (const [argv, message] of cases) {
      let err = "";
      const code = main(["serve", "--no-config", ...argv], { stdout: () => {}, stderr: (text) => (err += text), isTty: false });
      assert.equal(code, 2, argv.join(" "));
      assert.match(err, message, argv.join(" "));
    }
  }));

test("builtcheck serve --help describes it, and it is listed with the other commands", () => {
  let out = "";
  assert.equal(main(["serve", "--help"], { stdout: (text) => (out += text), stderr: () => {}, isTty: false }), 0);
  assert.match(out, /--port <n>/);
  assert.match(out, /--host <address>/);
  assert.match(out, /--site <folder>/);
  assert.ok(COMMANDS.serve);
  let help = "";
  main(["--help"], { stdout: (text) => (help += text), stderr: () => {}, isTty: false });
  assert.match(help, /builtcheck serve +Browse saved runs/);
});
