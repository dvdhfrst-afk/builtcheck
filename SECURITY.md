# Security

## Reporting a problem

Use the private vulnerability reporting of the repository you got this from, if it has one. Please do not open a public issue for something that could harm people using the tool. Say what input triggers it and what happens.

## What builtcheck does

It reads a folder and writes a report. It makes no network requests, starts no other programs, opens no ports, and runs nothing from the site it audits: scripts in pages are never run, and JSON-LD (JavaScript Object Notation for Linked Data) is parsed as data. `tests/failure.test.js` checks that the source imports no network or process module.

The site being audited is treated as untrusted. You might run this on a build containing content from anyone.

## What it defends against

- **Reading outside the folder.** Links, `@import`, sitemap entries and `robots.txt` lines resolve inside the site folder or to nothing. A symbolic link that leaves the folder counts as existing, so links to it stay valid, but it is never read, and the report names it.
- **Injection through reports.** File names and page text are escaped in the HTML report. Control characters and direction overrides are shown as escapes in text and GitHub output, so a page cannot move your terminal's cursor, hide lines, or start a workflow command in a continuous integration log.
- **Hostile input that burns time.** Deep nesting, unclosed comments, long lines of wildcards, selector chains that backtrack, and similar inputs are bounded. `tests/failure.test.js` holds a timed case for each kind found.
- **Decompression bombs.** A compressed sitemap is limited to 64 MiB (mebibytes) when decompressed.
- **Large files.** A text file over 32 MiB is not read. The report names it, and the run exits 2 instead of passing.
- **Losing a report.** `--output` writes a temporary file and renames it, so an interrupted run leaves any earlier report as it was. It refuses to write inside the site folder, and refuses a read-only target.

## What it does not defend against

- **Running out of memory.** Many large files that are each under the limit can exhaust memory. Node.js then stops the process with a non-zero exit code and no report. It cannot end in a false pass, but it can end the run. If you audit untrusted builds, limit the memory and time of the process from outside it, as a container or a job timeout would.
- **Your own config.** Regular expressions in `extraPatterns` and `classPatterns` run as you wrote them, and a slow one is slow. A config file is treated as trusted, so do not take one from a source you would not take code from.
- **Being a sandbox.** A file system race, such as a link swapped for another between check and read, is outside what this tool handles. Audit a build nobody is changing.
- **Judging content.** It does not look for malware, secrets or unsafe scripts in your site.
