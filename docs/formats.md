# Report formats

`--format <name>` picks how the report is written, and `--output <file>` writes it to a file instead of standard output. The file is written whole or not at all, and it must be outside the site folder. The exit code is the same whatever the format: see [ci.md](ci.md#exit-codes).

| Format | What it is | Where it is used |
|---|---|---|
| `text` | Readable report, the default | A terminal, a CI log |
| `json` | The full result | Your own scripts and tools |
| `html` | One self-contained page with filters | Opening in a browser, keeping as a CI artifact |
| `github` | Workflow commands | GitHub Actions annotations |
| `sarif` | SARIF (Static Analysis Results Interchange Format) 2.1.0 | Code scanning services |
| `markdown` | GitHub flavored Markdown | A pull request or merge request comment |
| `junit` | JUnit XML (Extensible Markup Language) | Test reports in GitLab, Jenkins, Azure Pipelines and most CI systems |
| `csv` | CSV (comma-separated values) as RFC 4180 describes it | A spreadsheet |
| `codeclimate` | Code Climate issue JSON | GitLab code quality reports |
| `checkstyle` | Checkstyle XML | Jenkins Warnings, reviewdog and other CI plugins |

Every sample on this page is cut from a real run on the example site in this repository, narrowed to four rules so the samples stay short (a test checks that each one still matches):

```bash
node bin/builtcheck.js examples/before --no-config --only links/broken-internal,links/missing-anchor,copy/placeholder-text,schema/page-missing --format markdown
```

Paths in every format are relative to the site folder and use `/`. They name built files, not the sources that produced them, so a service that links findings to files in your repository can only do so if the build output is committed. Text taken from the audited site, such as a file name or a quoted heading, is escaped in every format so that it cannot add markup, start a command or move the terminal cursor.

None of these formats has been tried with an upload to the service that reads it. Each was checked against the shape its documentation describes.

## `text`

The default. Findings are grouped by file. A finding repeated across many files prints once with a count, and one rule within one file is capped, so a large report stays readable. `--all` lists everything and `--quiet` lists errors only. Colors are used only in a terminal, and never with `--output` or `NO_COLOR` set.

```text
about/index.html
           warning  Page has no JSON-LD structured data  schema/page-missing
  15:4     error    Placeholder text (template text): "Your text here."  copy/placeholder-text

blog/first-loaf/index.html
  14:1     error    Link /blog/ does not resolve to any file in the build  links/broken-internal
...
5 errors, 1 warning in 3 pages, 1 stylesheet.
```

## `json`

The object the programmatic `audit()` call returns. Which fields you can rely on, and what `complete` and `skipped` mean, is in [ci.md](ci.md#the-json-report).

```json
{
  "tool": "builtcheck",
  "resultVersion": 1,
  "root": "examples/before",
  "complete": true,
  ...
}
```

## `html`

One page with no external files, safe to keep as a CI artifact and open from disk. It starts with the totals and a table of findings by rule group, then lists findings by file. The filters narrow the list by severity, rule, rule group and file, and a search box matches message text and file names. Choosing a group in the table, or "All links rules" in the rule filter, shows that whole group.

```html
<table class="groups"><thead><tr><th scope="col">Group</th><th scope="col">Errors</th><th scope="col">Warnings</th><th scope="col">Rules</th></tr></thead>
<label>File <select id="file"><option value="all">All</option><option value="about/index.html">about/index.html</option>
```

## `github`

One workflow command per finding, so GitHub Actions shows each one as an annotation on the run, and on the pull request when the file is in it. The last line is a summary for the log. See [ci.md](ci.md#github-actions) for a workflow.

```text
::warning file=about/index.html,title=schema/page-missing::Page has no JSON-LD structured data
::error file=about/index.html,line=15,col=4,title=copy/placeholder-text::Placeholder text (template text): "Your text here."
```

## `sarif`

SARIF 2.1.0, with one rule entry for every rule. Each rule entry carries a short description, a full description with its default severity and option names, and a `helpUri` pointing at its page under `docs/rules/`. That link is relative to this repository, which is also the layout of the installed package, since an offline tool has no web address of its own. When the audit is incomplete the run is marked `executionSuccessful: false` and each left out file is a tool notification. More in [ci.md](ci.md#sarif).

```json
            {
              "id": "links/broken-internal",
              "shortDescription": {
                "text": "An internal link does not resolve to a built file."
              },
              "fullDescription": {
                "text": "An internal link does not resolve to a built file. Default severity: error. Documented in docs/rules/links.md."
              },
              "helpUri": "docs/rules/links.md",
```

## `markdown`

A comment to post on a pull request: a summary table by rule group, then the findings of each rule with file and line, errors first. A rule with more than five findings folds its list into a `<details>` element. The comment stops before 60,000 characters, safely under GitHub's limit of 65,536 for one comment, and ends with a line saying how many findings it left out, if any. The first line is a hidden marker, `<!-- builtcheck-report -->`, so a workflow can find its own earlier comment and replace it rather than add another.

Text from the site is escaped so it reads as written: it cannot close a table cell, add a link, image, HTML tag or math block, and an `@name` in it does not notify anyone (a zero width word joiner follows each `@`).

```markdown
<!-- builtcheck-report -->
### builtcheck: 5 errors, 1 warning

Audited 3 pages and 1 stylesheet in examples/before.

| Group | Errors | Warnings |
|---|---:|---:|
| schema | 0 | 1 |
| links | 3 | 0 |
| copy | 2 | 0 |
| **Total** | **5** | **1** |

#### `links/broken-internal`: 2 errors

An internal link does not resolve to a built file.

| File | Line | Message |
|---|---:|---|
| blog/first-loaf/index.html | 14:1 | Link /blog/ does not resolve to any file in the build |
| index.html | 15:34 | Link /menu/ does not resolve to any file in the build |
...
```

To post it from GitHub Actions with the GitHub command line tool that the hosted runners carry (the job needs `pull-requests: write` permission):

```yaml
      - run: node tools/builtcheck/bin/builtcheck.js dist --format markdown --output builtcheck.md
        continue-on-error: true
      - run: gh pr comment "${{ github.event.pull_request.number }}" --body-file builtcheck.md
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
```

## `junit`

JUnit XML, the test report format most CI systems display. Each rule group is a test suite, named for the group, and each rule is a test case. A rule with findings fails, with a `failure` element whose type is its severity and whose text lists every finding with its place. Warnings fail their test case too, since a test report has no "passed with warnings"; the exit code still decides the job. A rule that crashed on some file has an `error` element naming the files, because its silence there proves nothing.

Every rule is a test case, including rules turned off in the config or left out with `--only` and `--skip`. Those found nothing, so they show as passed.

When the audit left files out, one more suite, `audit`, holds a test case listing them as `system-err`. It is an error when any of them could not be read or a rule failed on it, the same cases that make the exit code 2. Control characters, which XML cannot hold, are written as `\u` escapes.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="builtcheck" tests="129" failures="4" errors="0">
  <testsuite name="links" tests="6" failures="2" errors="0" skipped="0">
    <testcase name="links/broken-internal" classname="builtcheck.links">
      <failure type="error" message="2 errors">blog/first-loaf/index.html:14:1  error  Link /blog/ does not resolve to any file in the build
index.html:15:34  error  Link /menu/ does not resolve to any file in the build</failure>
    </testcase>
    <testcase name="links/missing-anchor" classname="builtcheck.links">
      <failure type="error" message="1 error">index.html:15:60  error  Link #order points at an id that is not on this page</failure>
    </testcase>
...
```

In GitLab CI, as a test report on the merge request. The first run writes the report and `|| true` keeps the job going; the second run's exit code decides the job:

```yaml
builtcheck:
  script:
    - npm ci
    - npm run build
    - node tools/builtcheck/bin/builtcheck.js dist --format junit --output builtcheck-junit.xml || true
    - node tools/builtcheck/bin/builtcheck.js dist --quiet
  artifacts:
    when: always
    reports:
      junit: builtcheck-junit.xml
```

In Azure Pipelines:

```yaml
- script: node tools/builtcheck/bin/builtcheck.js dist --format junit --output $(Build.ArtifactStagingDirectory)/builtcheck-junit.xml
- task: PublishTestResults@2
  condition: always()
  inputs:
    testResultsFormat: JUnit
    testResultsFiles: $(Build.ArtifactStagingDirectory)/builtcheck-junit.xml
```

In a Jenkins pipeline, the `junit` step reads the same file.

## `csv`

For a spreadsheet: a header row, then one finding per row, with CRLF line ends and quotes as RFC 4180 describes. `line` and `column` are empty for a finding about a whole file. The file is UTF-8 without a byte order mark; in Excel, open it through Data, From Text/CSV, so that accented text is read correctly.

A spreadsheet treats a cell that starts with `=`, `+`, `-` or `@` as a formula, and text from a hostile page could use that. Any such cell is written with a leading apostrophe, so it is read as text. Tabs, carriage returns and other control characters are written as `\u` escapes, so they cannot start a formula either.

```csv
file,line,column,severity,rule,message
about/index.html,,,warning,schema/page-missing,Page has no JSON-LD structured data
about/index.html,15,4,error,copy/placeholder-text,"Placeholder text (template text): ""Your text here."""
blog/first-loaf/index.html,14,1,error,links/broken-internal,Link /blog/ does not resolve to any file in the build
```

## `codeclimate`

A JSON array of Code Climate issues, which GitLab reads as a code quality report and shows on merge requests as new and fixed findings. Severity is `major` for an error and `minor` for a warning. Category is `Style` for the style preference rules, `Clarity` for other copy rules and `Bug Risk` for the rest. A finding about a whole file points at line 1, since GitLab needs a line.

GitLab tells new findings from old ones by `fingerprint`. builtcheck makes it from the rule, the file and the message, and not the line, so editing a page above a finding does not make it look fixed and found again. Two identical findings in one file are told apart by which comes first.

```json
  {
    "type": "issue",
    "engine_name": "builtcheck",
    "check_name": "copy/placeholder-text",
    "description": "Placeholder text (template text): \"Your text here.\"",
    "categories": [
      "Clarity"
    ],
    "severity": "major",
    "fingerprint": "ed119f9572ac85c50c57846d56dcb47f",
    "location": {
      "path": "about/index.html",
      "lines": {
        "begin": 15
      }
    }
  },
```

In GitLab CI:

```yaml
builtcheck-quality:
  script:
    - npm ci
    - npm run build
    - node tools/builtcheck/bin/builtcheck.js dist --format codeclimate --output gl-code-quality-report.json || true
  artifacts:
    when: always
    reports:
      codequality: gl-code-quality-report.json
```

## `checkstyle`

Checkstyle XML: one `file` element per file, one `error` element per finding, with `source` set to the rule id. `line` and `column` are left out for a finding about a whole file. A file the audit left out gets an entry too, with `source="builtcheck"`: severity `error` when it could not be read, `info` when it was left out on purpose, such as a symbolic link leading out of the site folder.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<checkstyle version="4.3">
  <file name="about/index.html">
    <error severity="warning" message="Page has no JSON-LD structured data" source="schema/page-missing"/>
    <error line="15" column="4" severity="error" message="Placeholder text (template text): &quot;Your text here.&quot;" source="copy/placeholder-text"/>
  </file>
...
</checkstyle>
```

In a Jenkins pipeline with the Warnings plugin:

```groovy
sh 'node tools/builtcheck/bin/builtcheck.js dist --format checkstyle --output builtcheck-checkstyle.xml || true'
recordIssues tool: checkStyle(pattern: 'builtcheck-checkstyle.xml')
```
