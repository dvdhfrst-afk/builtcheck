# Changelog

## 1.0.0 (2026-11-07)

The first version.

- Audits a built static site folder offline, with 129 rules in eleven groups: foundation files, page metadata, languages and alternate versions, structured data (with deeper schema checks), links, accessibility, assets, feeds, web app manifest, copy and style.
- Reports as text, JSON (JavaScript Object Notation), HTML (HyperText Markup Language), GitHub workflow annotations, SARIF (Static Analysis Results Interchange Format), Markdown, JUnit XML (Extensible Markup Language), CSV (comma-separated values), Code Climate and Checkstyle.
- Configured by a JSON file and inline ignore comments, with `--only`, `--skip`, `--explain`, `--init`, `--list-rules` and `--print-config` on the command line.
- Config presets and `extends`: `builtcheck:recommended`, `strict`, `seo`, `accessibility` and `minimal`, or any other config file, listed with `builtcheck presets`.
- A results store: `--save` and `--label` keep runs, and the `history`, `show`, `compare`, `import` and `store` commands read them back, compare two, add existing JSON reports and look after the store.
- `builtcheck serve`: a local web page and JSON API (application programming interface) for browsing saved runs, comparing them and starting audits. It listens on this computer only by default.
- Exits 2, and says what it could not read, whenever an audit cannot finish.
