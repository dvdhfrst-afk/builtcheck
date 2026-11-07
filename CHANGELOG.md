# Changelog

## 1.0.0 (2026-11-07)

The first version.

- Audits a built static site folder offline, with rules for foundation files, structured data, links, copy and style.
- Reports as text, JSON (JavaScript Object Notation), HTML (HyperText Markup Language), GitHub workflow annotations and SARIF (Static Analysis Results Interchange Format).
- Configured by a JSON file and inline ignore comments, with `--only`, `--skip`, `--explain`, `--init` and `--print-config` on the command line.
- Exits 2, and says what it could not read, whenever an audit cannot finish.
