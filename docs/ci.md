# Running builtcheck in continuous integration

Run it after the build step, and let the exit code decide the job. Everything below is meant to stay stable, so a pipeline can depend on it.

## Exit codes

| Exit code | Meaning | What a pipeline should do |
|---|---|---|
| 0 | No errors, and warnings within any limit you set | Pass |
| 1 | Errors, or more warnings than `--max-warnings` allows | Fail: the site has problems |
| 2 | It could not run or could not finish | Fail: nothing is certain about the site |

Findings and a report can still be written on exit code 2, when the audit ran but some file could not be read. A pipeline must not read that as a pass.

## GitHub Actions

builtcheck is not on the npm registry, so keep a copy of it in your repository, here in `tools/builtcheck`. This has not been run on GitHub Actions itself; the `github` output format was only checked as text.

```yaml
name: Audit the built site
on: [push, pull_request]
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - run: node tools/builtcheck/bin/builtcheck.js dist --format github
```

`--format github` prints a workflow annotation for each finding, so they show on the pull request. GitHub limits how many annotations it shows for one step, so on a large report the log holds more than the page shows. For the whole list, keep a report as well:

```yaml
      - run: node tools/builtcheck/bin/builtcheck.js dist --format html --output builtcheck-report.html
        if: always()
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: builtcheck-report
          path: builtcheck-report.html
```

Text from the site goes through an escape step in the `github` and `text` formats, so a hostile file name or page cannot start a workflow command or move the terminal cursor.

## SARIF

`--format sarif` writes SARIF (Static Analysis Results Interchange Format) version 2.1.0, with one rule entry per rule and paths relative to the site folder as encoded URIs. When the audit is incomplete, the run is marked `executionSuccessful: false`, and each skipped file is listed as a tool notification. The paths are relative to the built folder, not to your sources, so a code scanning service cannot link findings to the source files that produced them. It has not been tried with an upload to any such service.

## The JSON report

`--format json` writes one JSON (JavaScript Object Notation) document to standard output, or to the file named by `--output`. With a set site and config, repeated runs give identical output.

```json
{
  "tool": "builtcheck",
  "version": "1.0.0",
  "resultVersion": 1,
  "root": "dist",
  "site": { "host": "www.example.com", "basePath": "/" },
  "complete": true,
  "summary": { "errors": 1, "warnings": 0, "suppressed": 0, "pages": 3, "stylesheets": 1, "files": 8 },
  "findings": [
    {
      "rule": "links/broken-internal",
      "severity": "error",
      "message": "Link /menu/ does not resolve to any file in the build",
      "file": "index.html",
      "line": 15,
      "column": 34
    }
  ],
  "skipped": []
}
```

| Field | Meaning |
|---|---|
| `resultVersion` | Goes up only when a field here changes meaning or goes away. New fields can appear at any time, so ignore fields you do not know. |
| `version` | The builtcheck version that wrote the report. |
| `root` | The folder as given on the command line. |
| `site.host` | The site's own host, set or inferred, or `null` if neither. |
| `site.basePath` | The path the site deploys under, set or inferred. `/` means none. |
| `complete` | False when a file could not be read or a rule failed. The findings are then not the whole story, and the exit code is 2. |
| `summary.suppressed` | Findings removed by ignore comments. They are not in `findings`. |
| `findings` | Sorted by file, then line, then column. `line` and `column` are `null` when a finding is about a whole file. `file` is relative to the site folder and always uses `/`. |
| `skipped` | Files left out, each with `file`, `reason` and `incomplete`. A file that is simply too large has `incomplete: false`: it is named, but it does not change the exit code. One that could not be read has `incomplete: true`. |

Rule ids and severities are the contract for matching findings. The wording of `message` can change between versions, so do not match on it.
