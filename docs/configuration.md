# Configuration

builtcheck reads `builtcheck.config.json` from the current folder if there is one, or the file named by `--config`. `--no-config` ignores any config file. The file is JSON (JavaScript Object Notation) and holds up to five settings: `extends`, `site`, `ignore`, `rules` and `store`. Anything else, a mistyped rule id or a mistyped option stops the run with exit code 2 and says what is wrong, rather than being ignored.

```json
{
  "extends": ["builtcheck:seo", "builtcheck:strict"],
  "site": {
    "url": "https://www.example.com",
    "basePath": "/docs",
    "externalPaths": ["/api/**"]
  },
  "ignore": ["drafts/**"],
  "rules": {
    "links/placeholder-href": "off",
    "foundation/robots-blocks-crawler": { "crawlers": ["GPTBot", "ExampleBot"] }
  },
  "store": { "path": ".builtcheck" }
}
```

To see the config a run will use, with every preset and file it extends applied and every default filled in:

```bash
node bin/builtcheck.js --print-config
```

What it prints is itself a valid config file, so it is also a way to start one.

## `extends`

A preset name or a path to another config file, or a list of them. The config starts from what it extends and changes it:

- Entries apply in the order they are listed, so a later entry wins over an earlier one.
- The file's own settings win over everything it extends.
- A file it names can extend presets and files of its own, which apply before it.

A path is relative to the file that names it, not to the current folder, so a shared config can sit anywhere. A config passed to `audit()` in code takes paths relative to the current folder. A missing file, a file that is not valid JSON, or a chain that comes back to a file it already passed through stops the run with a message naming the chain, such as `extends shared/team.json -> shared/base.json: rules."copy/em-dashes" is not a rule.`

How each setting combines along the chain:

| Setting | Combined how |
|---|---|
| `rules` | Each file's rules apply over the result so far, groups first and then exact rule ids, as in a single file. So a file's `"copy/*": "error"` overrides a rule id an earlier file set. |
| `site` | Setting by setting: a later `url` replaces an earlier one, and an `externalPaths` list replaces the whole earlier list. |
| `ignore` | The patterns add up, each kept once. |
| `store` | Only in the file builtcheck runs with. It says where this machine keeps saved runs, so a file that is extended may not set it. |

A shared config for several sites, and a project file that uses it:

```json
{
  "extends": "builtcheck:seo",
  "ignore": ["drafts/**"],
  "rules": { "foundation/robots-blocks-crawler": { "crawlers": ["GPTBot", "ClaudeBot", "ExampleBot"] } }
}
```

```json
{
  "extends": ["../shared/builtcheck.base.json", "builtcheck:strict"],
  "site": { "url": "https://www.example.com" }
}
```

### Built-in presets

Built-in presets are named `builtcheck:` and a word. Each is written as rule groups and rule ids, so a rule added to a group in a later version joins the presets that name its group. `builtcheck presets` lists them, with how many rules each turns on, and `builtcheck presets <name>` prints one as the full config it resolves to.

```bash
node bin/builtcheck.js presets strict
```

| Preset | What it does |
|---|---|
| `builtcheck:recommended` | Every rule at its default severity and options. The same as extending nothing, and a way to undo an earlier entry. |
| `builtcheck:strict` | Every warning becomes an error, except the four style preference rules (`copy/em-dash`, `copy/double-hyphen`, `style/pure-color` and `style/banned-font`), which stay as they are. |
| `builtcheck:seo` | Only the groups search engines and AI crawlers depend on: `foundation/*`, `meta/*`, `i18n/*`, `schema/*` and `links/*`. Every other rule is off. |
| `builtcheck:accessibility` | Only `a11y/*` and `links/*`. |
| `builtcheck:minimal` | Only broken links and missing foundation files: `links/broken-internal`, `links/missing-anchor`, `links/broken-asset`, `foundation/robots-missing`, `foundation/sitemap-missing`, `foundation/llms-txt-missing` and `foundation/social-image-missing`. |

A preset changes what came before it rather than replacing it, so presets combine: `["builtcheck:seo", "builtcheck:strict"]` is the SEO (search engine optimization) groups with their warnings made errors, in either order. A preset that keeps only some rules turns the others off, and leaves the ones it keeps as an earlier entry set them. `builtcheck:recommended` is the one preset that resets every rule.

## `rules`

Maps a rule id, a group such as `"copy/*"`, or `"*"` to a severity (`"error"`, `"warning"` or `"off"`; `"warn"` also works), or a rule id to an object of `severity` and options.

```json
{
  "rules": {
    "style/*": "off",
    "copy/em-dash": "error",
    "style/banned-font": { "severity": "error", "fonts": ["Comic Sans MS"] },
    "schema/required-field": { "required": { "LocalBusiness": ["name", "geo", "telephone"] } }
  }
}
```

- `"*"` applies first, then groups, then exact rule ids, wherever each appears in the file. So an exact entry beats a group entry.
- Setting options on a rule turns it on at its default severity, even when a group or a preset turned it off.
- Options you leave out keep their defaults. An object option such as `required` merges by key, so you can change one type's field list and leave the others alone. A list option replaces the whole default list.
- Every rule, its default severity and its options are in the [rule reference](rules.md). `--explain <rule>` prints one rule's options and defaults, and `--list-rules` lists them all.

`--only` and `--skip` on the command line narrow the rules after the config is applied, and take the same ids and groups.

## `ignore`

A list of glob patterns of files not to audit, relative to the site folder. Those files still count as existing, so links to them stay valid. `*` matches within one folder and `**` matches across folders, so `drafts/**` leaves out everything under `drafts/`.

## `site`

How the site deploys:

| Setting | Default | What it does |
|---|---|---|
| `url` | none | The deployed URL (Uniform Resource Locator), such as `https://www.example.com`. Absolute links to this host count as internal, and sitemap URLs on other hosts are reported. Also `--site-url`, which wins over the file. |
| `basePath` | none | The path the site deploys under, such as `/docs`. Also `--base-path`, which wins over the file. |
| `externalPaths` | `[]` | Glob patterns of URL paths that exist but are not in the build, such as an application served from the same host. Under a base path, write them with or without it. |
| `sitemapPaths` | `sitemap.xml`, `sitemap-index.xml`, `sitemap_index.xml`, `sitemap.xml.gz` | Where to look for a sitemap when `robots.txt` names none. |
| `socialImagePaths` | `og-default.png`, `og-image.png`, `og.png`, `social.png` and similar names, in `.png` and `.jpg`, at the root and under `images/`, `img/` and `assets/` | Where to look for the default social image, in order. `--print-config` shows the full list. |

When `url` is not set, the host is taken from the sitemap, `robots.txt` and canonical links. When `basePath` is not set, it is inferred from the sitemap if every URL shares a leading folder that is not in the build and removing it finds the pages, or else from the paths pages link to and load.

## `store`

Where saved runs are kept, and whether every run is saved:

| Setting | Default | What it does |
|---|---|---|
| `path` | `.builtcheck` | The results store folder, relative to the current folder. `--store <folder>` on the command line wins over it. |
| `save` | `false` | When `true`, every audit is saved, as if `--save` were given. |

```json
{
  "store": { "path": "reports/builtcheck", "save": true }
}
```

`store` may only appear in the file builtcheck runs with, not in a file it extends.

## Ignoring one finding in a page

To leave out one finding rather than a whole rule or file, put an ignore comment in the page or stylesheet. The [README](../README.md#ignoring-a-finding) describes the comment forms.
