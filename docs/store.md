# The results store

A run's report is printed or written once. The results store keeps a history of runs instead, so you can look back at any audit and see what changed between two: which problems a fix removed, and which a later change brought in.

The store is a folder, `.builtcheck` in the current folder unless you choose another. Nothing in it is sent anywhere, and builtcheck never reads it as part of a site.

## Saving runs

Add `--save` to an audit:

```bash
builtcheck dist --save
```

The report comes out as usual, and a line on standard error gives the new run's id:

```text
builtcheck: saved as run 20261109-142530-123 in .builtcheck
```

Name a run you will want to find again with `--label`, such as a release:

```bash
builtcheck dist --save --label release-2.4
```

To save every run without the flag, set it in `builtcheck.config.json`. `store.path` chooses the folder, relative to the folder you run builtcheck in, and `--store <folder>` overrides it for one run:

```json
{
  "store": { "path": ".builtcheck", "save": true }
}
```

Saving never changes the exit code of an audit, and an incomplete run (exit code 2) is saved too, marked as incomplete. If saving fails, the report has already been printed or written, and the exit code is 2.

The store must not be inside the site folder, where it would be audited and deployed as part of the site, so builtcheck refuses that before the audit starts. Keep the store out of version control too, by adding `.builtcheck/` to your `.gitignore`, unless you want the history shared with everyone who works on the site.

## Naming runs

Every command that takes a run accepts any of these:

| Name | Means |
|---|---|
| `20261109-142530-123` | The run with that id |
| `20261109-14` | The one run whose id starts that way. If several do, builtcheck lists them and asks for more of the id |
| `latest` | The newest run |
| `latest~1` | The run before the newest, and `latest~2` the one before that, and so on |

A run's id is the time it ran, in UTC (Coordinated Universal Time), to the millisecond: year, month and day, then hours, minutes and seconds, then milliseconds. So ids sort by time, and the start of an id picks out a day or an hour.

## Commands

Every store command takes `--store <folder>`, `--config <file>` and `--no-config` to find the store, `--format json` for output other programs can read, and `--help`.

### history

Lists the saved runs, newest first:

```bash
builtcheck history --limit 5
```

```text
3 runs in .builtcheck, newest first

ID                   DATE              ERRORS  WARNINGS  PAGES  STATUS    LABEL         FOLDER
20261109-142530-123  2026-11-09 14:25       0         3      3  complete  release-2.4   dist
20261108-091200-004  2026-11-08 09:12       4         3      3  complete                dist
20261107-170511-310  2026-11-07 17:05      15        14      3  complete                dist

Errors, oldest to newest: 15, 4, 0 (down 15)
```

Dates are in your local time. The last line follows the error count across the newest 12 runs shown.

### show

Shows a saved run as a report, in any report format, as if the audit had just run:

```bash
builtcheck show latest
```

```bash
builtcheck show latest~1 --format html --output last-week.html
```

It takes `--format`, `--output`, `--quiet`, `--all` and `--no-color` as an audit does. A text report starts with a line saying which run it is, when it ran and, when it was saved in a git repository, the branch and commit. `show` exits 0 whatever the run found, since showing it worked.

### compare

Shows what changed between two runs, the earlier one first:

```bash
builtcheck compare latest~1 latest
```

With no runs named it compares `latest~1` with `latest`, and with one it compares that run with `latest`.

```text
Comparing run 20261108-091200-004 with run 20261109-142530-123 (release-2.4)

            BEFORE  AFTER  CHANGE
  Errors         4      0      -4
  Warnings       3      3
  Pages          3      3

0 new, 4 gone, 3 still present.

Gone since 20261108-091200-004
  index.html:15:34  error    Link /menu/ does not resolve to any file in the build  links/broken-internal
  ...

Changes by rule
  links/broken-internal  2 -> 0  2 gone
  ...
```

Findings in the two runs are the same finding when their rule, file and message match. Their line numbers may differ, so a finding that moved because you added content above it counts as still present, not as gone and new. Up to 25 new and 25 gone findings are listed; `--all` lists every one, and the findings still present too.

Under "Notes", compare says when something besides the site could explain a change: the runs audited different folders, were made by different builtcheck versions, used different settings, or one of them was incomplete. Settings are compared as a digest of the effective configuration (every rule's severity and options, the site settings, `ignore`, `--only` and `--skip`), so two runs with the same digest checked the site in the same way.

`compare` only reports. It exits 0 whatever changed, and 2 only when it could not compare, so it does not fail a pipeline because the site got worse; an audit does that.

### import

Adds JSON (JavaScript Object Notation) reports written with `--format json --output` to the store, one run each:

```bash
builtcheck import reports/2026-11-01.json --label before-redesign
```

A report does not record when it ran, so the run is dated from the time the file was last written. A report that is already in the store, as a saved run or an earlier import, is not added again.

### store info, verify, prune and migrate

`builtcheck store info` prints the store's format version, how many runs it holds, its size, and its oldest and newest runs.

`builtcheck store verify` reads every run file and checks that it is a whole, valid run, and that the index agrees with the run files. It exits 0 when everything is in order and 1 when it found a problem. When the index is the problem, write it again from the run files:

```bash
builtcheck store verify --rebuild-index
```

A damaged run file does not affect the other runs. Restore it from a backup, or delete it.

`builtcheck store prune` removes old runs. `--keep <n>` keeps the newest n runs, and `--older-than <days>` removes runs that ran more than that many days ago. Given both, a run is removed when either says so. Add `--dry-run` to see the list first:

```bash
builtcheck store prune --keep 50 --dry-run
```

`builtcheck store migrate` converts an older store to the current format. See [Migration](#migration).

## The file layout

The layout below is a stable contract: other tools may read these files, and later versions of builtcheck will read every store written in this format. All files are UTF-8 JSON.

```text
.builtcheck/
  store.json
  index.json
  runs/
    20261107-170511-310.json
    20261108-091200-004.json
    20261109-142530-123.json
  lock
```

`store.json` marks the folder as a store and records its format:

```json
{
  "format": "builtcheck results store",
  "storeVersion": 2,
  "created": "2026-11-07T17:05:11.402Z",
  "createdBy": "builtcheck 1.0.0"
}
```

`runs/<id>.json` holds one run: the store format it was saved in, its metadata, and the full result, which is the same object `--format json` writes.

```json
{
  "storeVersion": 2,
  "meta": {
    "id": "20261109-142530-123",
    "ranAt": "2026-11-09T14:25:30.123Z",
    "savedAt": "2026-11-09T14:25:31.020Z",
    "label": "release-2.4",
    "folder": "dist",
    "toolVersion": "1.0.0",
    "configDigest": "1aa19d40e1b579113e08d2a2a19bfd381fdba5bb4d7986dce79baf78dd5c6de2",
    "resultDigest": "ef5a0e68fc3acc8b0da2f20eb394afe96a4f3755d4e17c955545c82b9473c93a",
    "git": { "branch": "main", "commit": "3f2c9a7d41b0e8c6f5a2d9b1e7c4a8f0d3b6e2a1" },
    "source": "audit"
  },
  "result": { "tool": "builtcheck", "version": "1.0.0", "resultVersion": 1, "...": "..." }
}
```

| Field | Meaning |
|---|---|
| `id` | The run's id, which is also its file name |
| `ranAt` | When the audit started, or for an imported report, when its file was last written |
| `savedAt` | When the run was put in the store |
| `label` | The `--label` given, or null |
| `folder` | The site folder as it was given on the command line |
| `toolVersion` | The builtcheck version that made the result |
| `configDigest` | SHA-256 (Secure Hash Algorithm, 256 bits) digest of the effective configuration, or null when not known |
| `resultDigest` | SHA-256 digest of the result, used to notice a report imported twice |
| `git` | The branch and commit of the git repository holding the current folder, or null outside one. Read from the files under `.git`; `branch` is null on a detached HEAD |
| `source` | `audit` for a saved run, `import` for an imported report, `report file` for one converted from a folder of reports |
| `file` | For an imported or converted report, the name of the file it came from |

`index.json` lists a summary of every run, oldest first, so `history` does not have to read every run file:

```json
{
  "storeVersion": 2,
  "runs": [
    { "id": "20261109-142530-123", "ranAt": "2026-11-09T14:25:30.123Z", "errors": 0, "warnings": 3, "pages": 3, "complete": true, "...": "..." }
  ]
}
```

Each entry holds the metadata fields above except `file`, along with the run's `errors`, `warnings`, `pages` and `complete`. The index can always be rebuilt from the run files, and builtcheck never trusts it over them: a run file the index does not list is still read, and an entry whose run file is gone is left out.

`lock` exists only while a run is being saved. If a builtcheck process is killed while saving, the lock it leaves is ignored once it is 30 seconds old.

Files and folders other than these are left alone, so the store folder can hold other things, such as the reports a migration moved aside.

### How writes stay safe

- Every file is written whole or not at all: it goes to a temporary file in the same folder, whose name starts with a dot, and is then renamed over the old one. An interrupted save leaves the previous file as it was.
- Saving holds the lock, so two runs saving at the same moment both get their entry in the index. A run waits up to 10 seconds for another to finish.
- A run file is written before the index. A save killed in between leaves a run that reading still finds, and `store verify --rebuild-index` puts it back in the index.
- Pruning removes run files before rewriting the index, for the same reason.

## Formats and versions

There are two version numbers, and both only go up.

`storeVersion` is the format of the store itself. Format 2 is the one described above. Format 1 is what came before the store existed: a plain folder of JSON reports, each written with `--format json --output`.

`resultVersion`, inside each result, is the shape of the result. It changes only when a field of the result changes or goes away; new fields can appear at any time. Results with `resultVersion` 1, and older reports that have no `resultVersion` at all, are brought up to date as they are read, so `show` and `compare` work the same on a run from any version. A field such reports lack gets its default: no skipped files, and complete when the run found pages.

A store or result from a newer builtcheck than the one you run is refused with a message saying so, rather than read wrongly.

## Migration

Every command reads an older store as it is: `history`, `show` and `compare` work on a folder of JSON reports with no conversion, using each file's time as the time of its run. Saving, importing and pruning need the current format, and ask you to convert first:

```bash
builtcheck store migrate reports
```

Migration converts the folder in place and keeps every run:

1. It reads every JSON report at the top of the folder. Each becomes a run, with the same id `history` showed before the conversion.
2. It writes the new store into a staging folder inside it, `.migrating`, without touching your reports.
3. It moves the new `runs` folder and `index.json` into place, and `store.json` last. Until `store.json` is in place the folder still reads as a folder of reports, so a migration that is interrupted loses nothing and can simply be run again.
4. Only then does it move the reports it converted into `reports-before-migration` inside the folder. Nothing reads them any more, so you can delete that folder once you are happy with the store.

It reports what it did: each file and the run it became. Files it could not use are left where they were and listed with the reason, such as a JSON file that is not a builtcheck report or one that is not valid JSON. Other files in the folder are not touched. Running it on a store already in the current format changes nothing.
