# Security

## Reporting a problem

Use the private vulnerability reporting of the repository you got this from, if it has one. Please do not open a public issue for something that could harm people using the tool. Say what input triggers it and what happens.

## What builtcheck does

It reads a folder and writes a report. It makes no network requests, starts no other programs, and runs nothing from the site it audits: scripts in pages are never run, and JSON-LD (JavaScript Object Notation for Linked Data) is parsed as data.

It opens no ports, with one exception you ask for by name: `builtcheck serve` listens on one local port for a web page that shows saved runs (see [docs/web.md](docs/web.md)). That command alone imports `node:http`, and it still makes no requests of its own. `tests/failure.test.js` checks that only `src/server/` imports `node:http`, that nothing imports any other network or process module, and that the page's scripts fetch only paths on the server that served them.

The site being audited is treated as untrusted. You might run this on a build containing content from anyone.

## What it defends against

- **Reading outside the folder.** Links, `@import`, sitemap entries and `robots.txt` lines resolve inside the site folder or to nothing. A symbolic link that leaves the folder counts as existing, so links to it stay valid, but it is never read, and the report names it.
- **Injection through reports.** File names and page text are escaped in the HTML report. Control characters and direction overrides are shown as escapes in text and GitHub output, so a page cannot move your terminal's cursor, hide lines, or start a workflow command in a continuous integration log.
- **Hostile input that burns time.** Deep nesting, unclosed comments, long lines of wildcards, selector chains that backtrack, and similar inputs are bounded. `tests/failure.test.js` holds a timed case for each kind found.
- **Decompression bombs.** A compressed sitemap is limited to 64 MiB (mebibytes) when decompressed.
- **Large files.** A text file over 32 MiB is not read. The report names it, and the run exits 2 instead of passing.
- **Losing a report.** `--output` writes a temporary file and renames it, so an interrupted run leaves any earlier report as it was. It refuses to write inside the site folder, and refuses a read-only target.

## The web page of `builtcheck serve`

The server shows saved runs, which hold file names and messages taken from audited sites, so it treats that text as hostile, and it treats every other web page open in your browser as a possible attacker.

- **Other computers.** It listens on `127.0.0.1`, this computer only, unless `--host` names another address, and then it warns that anyone who can reach that address can read every saved run (and with `--site`, start audits). `--host` takes only an address, never a host name, so where it listens is never decided by a name lookup.
- **DNS (Domain Name System) rebinding.** A page on another site can point a name it controls at 127.0.0.1 and then read from the server as if it were that site. The server answers only requests whose Host header is the address it listens on with its port, or `localhost` for a loopback address, and refuses every other name with 403.
- **Other sites reading or changing data.** It sends no CORS (Cross-Origin Resource Sharing) headers, so the browser keeps other sites from reading its answers, and `Cross-Origin-Resource-Policy: same-origin` keeps them from loading its answers as scripts or images. The only request that changes anything, starting an audit, is a POST that must have the content type `application/json` (which a plain form on another site cannot send), must carry a token that is made new each time the server starts and is written only into the server's own page (which another site cannot read), and is refused if its `Origin` header names another site.
- **Injection into the page.** Every file name, message, label, folder name and rule text is escaped before it goes into the page, wherever it goes, and control characters and direction overrides are shown as escapes. The page is built only through one escaping template. A Content-Security-Policy lets the page run scripts and load styles and data from the server alone, with no inline scripts, and forbids framing it (`frame-ancestors 'none'`). API answers and report downloads have a policy that lets them run and load nothing, and downloads are sent as attachments. Every response has `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- **Reading files through the server.** It serves a fixed list of its own files by exact path. Nothing in the site folder or the store folder is ever served as a file; saved runs are read only through the API, by run names it checks.
- **Large requests.** Request bodies over 16 KiB (kibibytes) are refused before they are read, and requests that send their headers or body too slowly are dropped.
- **Requests from outside your browser.** Anyone who can run a program on your computer can read the store folder directly, so the server does not try to keep local programs out. Reading needs no token; starting an audit does.

An audit started from the page runs in a worker thread inside the same process, not a new process, with the same limits as an audit from the command line.

## What it does not defend against

- **Running out of memory.** Many large files that are each under the limit can exhaust memory. Node.js then stops the process with a non-zero exit code and no report. It cannot end in a false pass, but it can end the run. If you audit untrusted builds, limit the memory and time of the process from outside it, as a container or a job timeout would.
- **Your own config.** Regular expressions in `extraPatterns` and `classPatterns` run as you wrote them, and a slow one is slow. A config file is treated as trusted, so do not take one from a source you would not take code from.
- **Being a sandbox.** A file system race, such as a link swapped for another between check and read, is outside what this tool handles. Audit a build nobody is changing.
- **Judging content.** It does not look for malware, secrets or unsafe scripts in your site.
