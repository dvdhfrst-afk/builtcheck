# The web page and its API

`builtcheck serve` opens a page in your browser for the runs saved in the [results store](store.md): a list of runs with a chart of errors and warnings over time, each run's findings with filters, a comparison of any two runs, and a description of every rule. Keep it open while you fix a site. Given a site folder, it can also start a new audit and show it when it finishes.

Everything the page shows comes from a JSON (JavaScript Object Notation) API on the same server, described below as a contract other tools can rely on.

## Starting it

```bash
builtcheck serve
```

```text
builtcheck: serving the results store .builtcheck at http://127.0.0.1:7750/
builtcheck: press Ctrl+C to stop
```

Open the address it prints. It runs until you press Ctrl+C, then exits 0. It exits 2 when it cannot start, such as when the port is in use:

```text
builtcheck: port 7750 on 127.0.0.1 is in use by another program. Choose another with --port, or --port 0 for any free port.
```

| Option | Means |
|---|---|
| `--port <n>` | The port to listen on, 7750 unless you choose another. `0` picks a free port, and the address printed says which |
| `--host <address>` | The address to listen on, `127.0.0.1` unless you choose another. It takes an IP (Internet Protocol) address or `localhost`, never another host name |
| `--site <folder>` | Lets the page start audits of this built site folder. See [Auditing from the page](#auditing-from-the-page) |
| `--store <folder>` | The results store, `.builtcheck` in the current folder unless the config file's `store.path` or this option names another |
| `--config <file>` | The config file to read `store.path` and, for audits, every other setting from. Without it, `builtcheck.config.json` in the current folder is read if it is there |
| `--no-config` | Read no config file |

The server opens the store again for every request, so runs saved from a terminal while it runs show up when you reload the page. It never writes to the store, except to save an audit started from the page.

## The page

The page needs no build step and loads nothing from the internet: its scripts, its style sheet and its icon come from the server, and its chart is drawn in the page. It works with the keyboard alone, every field has a label, and each page has one main heading that takes the focus when you move to it.

- **Saved runs** (`/`): the runs, newest first, 25 to a page, with their counts, status, label, folder and git branch. Above them, a chart of errors and warnings across the newest 60 runs, with a sentence that says the same for screen readers. Each run links to its page and to a comparison with the run before it.
- **A run** (`/runs/<run>`): when and where it ran, cards for errors, warnings, pages, style sheets, files and findings ignored inline, anything the audit could not cover, and a download of the run in any report format. Below them, its findings, filtered by severity, rule group, rule, file and a search of the message, file and rule, sorted, and shown either one by one or counted by file, rule or rule group. Choosing a group in a counted view lists its findings. The filters are kept in the page's address, so a filtered view can be bookmarked and the Back button undoes a step. Each finding links to its rule.
- **Compare** (`/compare`): choose two runs to see the counts before and after, the findings that are new and gone, the changes by rule, and the notes `builtcheck compare` gives, such as runs made with different settings.
- **Rules** (`/rules`, and `/rules/<group>/<name>` for one): every rule with its default severity, description and options, and a link to its findings in the latest run.

`<run>` is any name the store commands take: a run id, the start of one, `latest` or `latest~N`.

## Auditing from the page

```bash
builtcheck serve --site dist
```

With `--site`, the runs page has an **Audit now** button and an optional label. It runs the same audit and saves it the same way as this command would:

```bash
builtcheck dist --save
```

The config file is read again for each audit, so a change you make to it while fixing the site applies to the next one. The audit runs in a worker thread, so the page keeps answering, and when it finishes the page shows the new run. Only one audit runs at a time. The site folder, the config file and the store are checked when the server starts, so a mistake in any of them stops it with a message at once.

The page never changes the site, and offers nothing that changes what an audit reports: settings live in the config file.

## The API

All routes are under `/api/`, answer in JSON with the content type `application/json; charset=utf-8`, and include `"apiVersion": 1` in every answer. A field may be added to an answer at any time; `apiVersion` goes up when a field changes or goes away, as `resultVersion` does for results.

Query parameters are checked: an unknown parameter, a parameter given twice, or a value out of range is an error rather than being ignored, so a typing mistake does not quietly change an answer. Run names in paths are the names above, such as `latest~1`.

### Errors

An error answers with its status code and a plain message:

```json
{ "apiVersion": 1, "error": { "status": 404, "message": "No run in .builtcheck has an id starting \"2099\". builtcheck history lists the ids." } }
```

| Status | When |
|---|---|
| 400 | A bad parameter or request body, a name that is not a run name, or the start of several run ids |
| 403 | A Host header the server does not answer to, a POST request without the token or from another site, or an audit when the server has no `--site` |
| 404 | No such run, rule or route |
| 405 | A method the route does not take. The `Allow` header lists those it does |
| 409 | An audit is already running |
| 413 | A request body over 16 KiB (kibibytes) |
| 415 | A POST request whose body is not declared as JSON |
| 500 | A run file that cannot be read, with the reason, or a bug in builtcheck |

### `GET /api`

The server: `tool`, `version`, `store` (`path` as given, and `storeVersion`, or null when there is no store yet), `audits` (`enabled`, and `site` as given to `--site`), and `formats`, each report format's `name`, `description` and the file `extension` it downloads with.

### `GET /api/store`

What `builtcheck store info --format json` gives, under `store`: `path`, `exists`, `storeVersion`, `current`, `runs`, `unreadable` (each `{ id, reason }`), `bytes`, and the `oldest` and `newest` run entries.

### `GET /api/runs`

The runs, newest first. Takes `offset` (default 0) and `limit` (1 to 500, default 50). Answers `store`, `storeVersion`, `total`, `offset`, `limit`, `runs` and `unreadable`. Each run is its index entry, as described in [the file layout](store.md#the-file-layout): `id`, `ranAt`, `savedAt`, `label`, `folder`, `toolVersion`, `source`, `errors`, `warnings`, `pages`, `complete`, `configDigest`, `resultDigest` and `git`.

### `GET /api/runs/<run>`

One run, without its findings: `run` (its entry), `meta` (its metadata as saved), `result` (the result without `findings`: `tool`, `version`, `resultVersion`, `root`, `site`, `complete`, `summary` and `skipped`), `previous` and `next` (the ids of the runs before and after it, or null), and `facets`, which counts its findings for filters: `groups` and `rules`, each a list of `{ key, errors, warnings, findings }` sorted by name, and `files`, how many files have findings.

### `GET /api/runs/<run>/findings`

A run's findings. Filters, all optional, combined so that a finding must match every one given:

| Parameter | Keeps findings |
|---|---|
| `severity` | Of this severity, `error` or `warning`, or both separated by a comma |
| `rule` | Of these rules, separated by commas, such as `links/broken-internal` |
| `group` | Of rules in these groups, separated by commas, such as `links,copy` |
| `file` | In this one file, its path exactly as findings give it |
| `q` | Whose message, file or rule contains this text, ignoring case. Up to 200 characters |

`sort` is `position` (file, line and column, the default), `severity` (errors first), `rule` or `message`, and `order` is `asc` (the default) or `desc`. `offset` and `limit` (1 to 1000, default 100) choose a page.

Answers `run` (the id), `filter`, `sort`, `order`, `total` (how many match), `offset`, `limit` and `findings`, each `{ rule, severity, file, line, column, message }` as in a JSON report.

```text
GET /api/runs/latest/findings?severity=error&group=links&limit=20
```

### `GET /api/runs/<run>/groups`

The matching findings counted by `by`: `file` (the default), `rule` or `group`. Takes the same filters as `/findings`, `sort` of `count` (most errors first, then most warnings, the default) or `name`, and `offset` and `limit` (1 to 1000, default 100). Answers `run`, `by`, `sort`, `filter`, `findings` (how many findings match), `total` (how many groups), `offset`, `limit` and `groups`, each `{ key, errors, warnings, findings }`.

### `GET /api/runs/<run>/report`

The run as a report file to save, in the format `format` names (html unless given), with `Content-Disposition: attachment` and a file name such as `builtcheck-20261109-142530-123.sarif`. It is what this command writes:

```bash
builtcheck show latest --format sarif
```

So a text report starts with the line that says which run it is.

| Format | Content type | Extension |
|---|---|---|
| `text`, `github` | `text/plain` | `txt` |
| `json`, `codeclimate` | `application/json` | `json` |
| `html` | `text/html` | `html` |
| `sarif` | `application/sarif+json` | `sarif` |
| `markdown` | `text/markdown` | `md` |
| `junit`, `checkstyle` | `application/xml` | `xml` |
| `csv` | `text/csv` | `csv` |

### `GET /api/compare`

What changed between `before` (default `latest~1`) and `after` (default `latest`), the same answer as `builtcheck compare --format json`: `before` and `after` (the run entries), `notes`, `summary`, `rules`, and the lists `added`, `gone` and `still`. Each list holds at most `limit` findings (1 to 5000, default 200); `summary` gives their full counts.

### `GET /api/rules` and `GET /api/rules/<group>/<name>`

Every rule, or one, as `{ id, group, severity, description, options, docs }`: its default severity, its options with their defaults, and the page of this documentation that describes it.

### `GET /api/audit`

Whether audits are possible and what the last one did: `enabled`, `site`, `running`, and `audit`, null until one has started, then `{ number, state, label, startedAt, finishedAt, run, errors, warnings, complete, message, messages }`. `state` is `running`, `finished` or `failed`. A finished audit gives the new `run` id and its counts; a failed one gives the reason in `message`. `messages` lists files the audit could not read.

### `POST /api/audit`

Starts an audit of the `--site` folder and answers 202 with what `GET /api/audit` gives. The body is a JSON object that may hold a `label`, one line of up to 80 characters. The request must carry the token described below.

```text
POST /api/audit
Content-Type: application/json
X-Builtcheck-Token: <the token from the page>

{ "label": "release-2.4" }
```

## Security

The server is for the person who started it, on their own computer. [SECURITY.md](../SECURITY.md) describes what it defends against; in short:

- It listens on `127.0.0.1` unless `--host` says otherwise, and warns when it listens on any address other computers could reach. Anyone who can reach the server can read every saved run, and with `--site`, start audits.
- It answers only requests whose Host header names the address it listens on (or `localhost` for a loopback address). This blocks DNS (Domain Name System) rebinding, where a web page gets a name it controls pointed at your computer.
- It sends no CORS (Cross-Origin Resource Sharing) headers, so pages on other sites cannot read its answers.
- A POST request must have the content type `application/json`, must carry the per-server token from the page's `builtcheck-token` meta tag in an `X-Builtcheck-Token` header, and if it has an `Origin` header, it must be this server's. A new token is made each time the server starts.
- Every response has a Content-Security-Policy that lets the page load scripts, styles and data from the server alone, with `frame-ancestors 'none'`, along with `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`. API answers and downloads have a policy that lets them run and load nothing.
- File names, messages, labels and every other piece of text from a site or the store are escaped before they go into the page, and control characters and direction overrides are shown as escapes.
- It serves a fixed list of its own files and nothing else: the site and the store are read only through the API.
- Request bodies over 16 KiB are refused.
