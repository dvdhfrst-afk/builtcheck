# builtcheck

builtcheck audits a built static site folder such as `dist/`. It reads the files your build produced and reports the problems that page speed audits and link checkers leave out: a sitemap that disagrees with the pages, a social image of the wrong size, structured data missing the fields its type needs, "Read more" links that go nowhere, placeholder text that shipped, a grid that cannot fit on a phone.

It runs offline with no browser, makes no network requests, never changes the site folder, and has no dependencies. It needs Node.js 18 or newer and nothing else.

## Install

You need [Node.js](https://nodejs.org) 18 or newer. Check with:

```bash
node --version
```

builtcheck is not on the npm registry, so `npm install builtcheck` will not find it. Get a copy of this repository, by cloning or downloading it, and open a terminal in that folder. It runs from there with no install step and no build step:

```bash
node bin/builtcheck.js --version
```

To get a `builtcheck` command that works from any folder, pack the repository and install the package file it makes:

```bash
npm pack
```

```bash
npm install --global builtcheck-1.0.0.tgz
```

```bash
builtcheck --version
```

To add it to one project instead, run `npm install --save-dev` with the path to that same file, then `npx builtcheck`. The rest of this page uses `node bin/builtcheck.js`, which is the same program.

## First run

Try it on the sample site in this repository, which has a problem of nearly every kind:

```bash
node bin/builtcheck.js examples/before --no-config --quiet
```

`--quiet` lists errors only. This is the output in full:

```text
about/index.html
  15:4     error    Placeholder text (template text): "Your text here."  copy/placeholder-text

blog/first-loaf/index.html
  7:1      error    JSON-LD block has no schema.org "@context"  schema/missing-context
  14:1     error    Link /blog/ does not resolve to any file in the build  links/broken-internal

index.html
  7:35     error    Placeholder text (lorem ipsum) in the description meta tag: "Lorem ipsum dolor sit amet."  copy/placeholder-text
  8:1      error    Social image https://www.example.com/img/share.png is not in the build  foundation/page-social-image-broken
  10:1     error    Bakery "Harbor Street Bakery" is missing "address"  schema/required-field
  15:34    error    Link /menu/ does not resolve to any file in the build  links/broken-internal
  15:60    error    Link #order points at an id that is not on this page  links/missing-anchor
  19:1     error    Referenced file /img/loaf.png does not resolve to any file in the build  links/broken-asset
  20:1     error    "Read more" link has no destination  links/generic-no-destination

og-default.png
           error    Default social image is 1200x675, expected 1200x630  foundation/social-image-size

robots.txt
  2        error    robots.txt blocks GPTBot from the site ("Disallow: /")  foundation/robots-blocks-crawler

sitemap.xml
  4:8      error    Sitemap lists https://www.example.com/menu/, but the build has no page there  foundation/sitemap-stale-url
  5:8      error    Sitemap URL points at a local address: http://localhost:4321/about/  foundation/sitemap-host

styles.css
  8:3      error    12 grid columns need 440px for gaps alone, wider than a 390px phone  style/phone-overflow

15 errors, 14 warnings in 3 pages, 1 stylesheet.
```

[examples/README.md](examples/README.md) walks through that site and a fixed copy of it, which comes back clean.

## Check your own site

Build your site first, then point builtcheck at the folder the build wrote. Common defaults:

| Generator | Folder |
|---|---|
| Astro | `dist` |
| Next.js static export | `out` |
| Hugo | `public` |
| Eleventy | `_site` |
| Docusaurus | `build` |

```bash
node bin/builtcheck.js path/to/dist
```

If your site lives under a path such as `/docs`, or absolute links name your own domain, tell it so. Both are usually worked out from the build, and the report does better when they are stated:

```bash
node bin/builtcheck.js path/to/dist --site-url https://www.example.com --base-path /docs
```

### Reading a first report

Fix errors first. An **error** means something is definitely broken or missing. A **warning** means a recommendation or a style preference, and warnings alone do not fail a run.

Four warning rules are matters of taste, and a site can reasonably disagree with all of them: `copy/em-dash`, `copy/double-hyphen`, `style/pure-color` and `style/banned-font` (by default Inter, Roboto, Helvetica and Open Sans). They can run to hundreds of findings on a large site, so the text report names them at the end. To leave them out of one run:

```bash
node bin/builtcheck.js path/to/dist --skip copy/em-dash,copy/double-hyphen,style/pure-color,style/banned-font
```

To decide for good, write a starter config and set them to `"off"`:

```bash
node bin/builtcheck.js --init
```

To see what a rule looks for and which options it takes:

```bash
node bin/builtcheck.js --explain style/phone-overflow
```

## Exit codes

| Exit code | Meaning |
|---|---|
| 0 | No errors, and warnings within any limit you set |
| 1 | Errors, or more warnings than `--max-warnings` allows |
| 2 | It could not run or could not finish: a missing folder, a folder with no HTML (HyperText Markup Language) pages, a bad config file, a bad option, or a file it could not read or that was too large |

Exit code 2 never means your site passed. A folder with no pages is exit code 2 on purpose, because it usually means the build did not run. When a file cannot be read, as when another program has it locked, the audit still reports everything else and names the file under "Not covered by this audit", then exits 2, because a clean result would not be true.

## What it checks

The rules come in five groups. [docs/rules.md](docs/rules.md) lists every rule, its default severity and its options. To list them from the command line:

```bash
node bin/builtcheck.js --list-rules
```

- **Foundation:** `robots.txt` exists and does not block the crawlers you care about, `llms.txt` exists and has a title, the sitemap matches the built pages in both directions, and the default social image is exactly the configured size (read from PNG and JPEG file headers). The default crawler list is ten artificial intelligence crawlers; change it to anything.
- **Structured data:** every JSON-LD (JavaScript Object Notation for Linked Data) block parses, each page has one, each node has the fields its type requires, question and answer pages carry `FAQPage`, and blog posts carry `Article`. Types and their field lists are defaults you can replace.
- **Links:** internal links, in-page anchors and referenced files resolve to files and ids that exist in the build. "Read more" style links with no real destination are reported.
- **Copy:** em dashes and `--` in visible text (never in code, attributes or scripts), duplicate headings and subheads, and placeholder text.
- **Style:** pure black and white in any notation and configured fonts, in CSS (Cascading Style Sheets), `<style>` blocks and inline styles; layouts that overflow at phone width in those and in utility classes. CSS that matches nothing on any page is skipped, so an unused part of a framework is not reported.

Choose rules for one run with `--only` and `--skip`, which take rule ids and groups separated by commas. To fail on any warning, use `--max-warnings`:

```bash
node bin/builtcheck.js path/to/dist --only "links/*,schema/*"
```

```bash
node bin/builtcheck.js path/to/dist --max-warnings 0
```

## Output formats

Text is the default. It collapses a finding repeated across many files, and caps one rule within one file, so a large report stays readable. Use `--all` to list everything, or `--quiet` to list errors only. Run `node bin/builtcheck.js --help` for every option.

`--output` writes any format to a file. The file is written whole or not at all, so a failed or interrupted run leaves an earlier report as it was. It refuses a path inside the site folder, where the report would be deployed with the site.

A single self-contained HTML report with filters by severity and rule:

```bash
node bin/builtcheck.js path/to/dist --format html --output report.html
```

JSON (JavaScript Object Notation), for other tools:

```bash
node bin/builtcheck.js path/to/dist --format json --output report.json
```

`github` prints workflow annotations for GitHub Actions, and `sarif` writes SARIF (Static Analysis Results Interchange Format) for code scanning tools. [docs/ci.md](docs/ci.md) has a workflow to copy and the details of the JSON report: which fields you can rely on, and what `complete` and `skipped` mean.

## Configuration

builtcheck reads `builtcheck.config.json` from the current folder if there is one, or the file named by `--config`. `--no-config` ignores any config file. See [examples/builtcheck.config.json](examples/builtcheck.config.json) for a realistic one. A mistyped rule or option stops the run with exit code 2 and says what is wrong, rather than being ignored.

```json
{
  "site": {
    "url": "https://www.example.com",
    "basePath": "/docs",
    "externalPaths": ["/api/**"]
  },
  "ignore": ["drafts/**"],
  "rules": {
    "style/*": "off",
    "copy/em-dash": "error",
    "style/banned-font": { "severity": "error", "fonts": ["Comic Sans MS"] },
    "foundation/robots-blocks-crawler": { "crawlers": ["GPTBot", "ExampleBot"] }
  }
}
```

**`rules`** maps a rule id, a group such as `"copy/*"`, or `"*"` to a severity (`"error"`, `"warning"` or `"off"`), or a rule id to an object of `severity` and options. An exact rule entry beats a group entry wherever it appears in the file. Setting options on a rule turns it on at its default severity even when a group turned it off. Options you leave out keep their defaults. An object option such as `required` merges by key, so you can change one type's field list and leave the others alone.

To see every default, as text you can start a config from:

```bash
node bin/builtcheck.js --print-config
```

**`ignore`** lists glob patterns of files not to audit, relative to the site folder. Those files still count as existing, so links to them stay valid. `*` matches within one folder and `**` matches across folders.

**`site`** describes how the site deploys:

| Setting | What it does |
|---|---|
| `url` | The deployed URL (Uniform Resource Locator). Absolute links to this host count as internal, and sitemap URLs on other hosts are reported. Also `--site-url`. |
| `basePath` | The path the site deploys under, such as `/docs`. Also `--base-path`. |
| `externalPaths` | Glob patterns of URL paths that exist but are not in the build, such as an application served from the same host. Under a base path, write them with or without it. |
| `sitemapPaths` | Where to look for a sitemap when `robots.txt` names none. |
| `socialImagePaths` | Where to look for the default social image, in order. |

When `url` is not set, the host is taken from the sitemap, `robots.txt` and canonical links. When `basePath` is not set, it is inferred from the sitemap if every URL shares a leading folder that is not in the build and removing it finds the pages. With no sitemap, it is inferred the same way from the paths pages link to and load. A `_redirects` file in the build counts: a path it redirects is a valid link, with or without the base path in its source.

## Ignoring a finding

Put a comment in the file. The same forms work in HTML comments, in CSS comments and in `#` or `<!-- -->` comment lines in text files such as `robots.txt`. Name one or more rules, or a group, or nothing to mean every rule. Text after ` -- ` is a reason and is not read.

- `builtcheck-ignore-file` covers the whole file.
- `builtcheck-ignore-next-line` covers the next line. If code follows the comment on its own line, as in a minified file, it covers the rest of that line instead.
- `builtcheck-ignore-next-element` covers the next HTML element with everything in it, the next CSS rule, or in a text file the next lines up to a blank line or a closing XML tag.

```html
<!-- builtcheck-ignore-next-line copy/em-dash -- quoted from a book -->
<p>The title of the book has a dash in it: A &mdash; B</p>

<!-- builtcheck-ignore-next-element copy/* -->
<section>Everything in here, however many lines, is ignored for copy rules.</section>

<div data-builtcheck-ignore="style/phone-overflow">This form survives minifiers that strip comments.</div>
```

```css
/* builtcheck-ignore-file style/pure-color */
/*! builtcheck-ignore-next-line style/banned-font */
```

The text, JSON and HTML reports give a count of the findings ignored this way.

## Using it from code

Installed as a package, it exports one synchronous function. The package is an ES module only: use `import`, in a `.mjs` file or a project with `"type": "module"`. The second argument has the shape of a config file, and the result has the shape of the JSON report.

```js
import { audit } from "builtcheck";

const result = audit("dist", { rules: { "style/*": "off" } });
if (!result.complete) console.error("Not everything could be read:", result.skipped);
for (const finding of result.findings) console.log(finding.file, finding.line, finding.rule, finding.message);
```

It throws for a folder it cannot open or an invalid config. A file it cannot read does not throw: it lands in `skipped`, and `complete` turns false. `complete` is also false for a folder with no pages, which is what the command line's exit code 2 stands for here, so check it.

## Troubleshooting

| You see | What it means |
|---|---|
| `Folder not found` | The path is wrong, or it is relative to a different folder from the one the terminal is in. |
| `no HTML pages in ...` | The build has not run, or the pages are all ignored by your config. |
| `looks like a project folder` | You pointed it at the project, and the build is in a folder inside it. The message names it. |
| `is a file path, not a URL path` | Git Bash on Windows rewrites arguments that start with `/`. Write `--base-path //docs` there, or set `basePath` in a config file. |
| `outside the base path` | The base path you gave is probably wrong, and links it leaves out are not checked. |
| Many broken links that work when deployed | The site deploys under a path. Set `--base-path`, or see "Limits" for links that only exist at run time. |
| `is inside the site folder` | `--output` points inside the audited folder. Write the report somewhere else. |
| `Did you mean` or `is not an option of` | A mistyped name in the config. `--list-rules` and `--explain` show the right ones. |
| `Not covered by this audit`, exit code 2 | A file could not be read, usually a lock or a permission. Its reason is printed beside it. Fix that and run again. |
| `this is a bug in builtcheck` | It is. Set the `BUILTCHECK_DEBUG` environment variable to `1` and run again to see where, then report it. |

## What has been tested

builtcheck has no public track record yet. This is what was actually run, and every number here comes from those runs.

- **Test suite:** on Node.js 18.20.8, on Windows 11 and on Ubuntu under the Windows Subsystem for Linux, as an unprivileged user there so file permissions and symbolic links were exercised. It was also run on Node.js 24 on Windows. macOS has not been tried.
- **Real sites:** three real Astro builds of 78, 43 and 3 pages. Every distinct error was checked by hand against the files. All were real but one: a sentence that used `[your company]` as an example was reported as a placeholder.
- **Other generators:** Next.js, Hugo, Eleventy and Docusaurus sites have **not** been built and audited. `tests/generators.test.js` uses pages written by hand to follow the markup each is known to emit, which guards against known false alarms but is not the same as real output. Expect some surprises there.
- **Scale:** 10,001 generated pages, 318 MB (megabytes) of HTML, on Node.js 18.20.8 with an Intel Core i7-14700F and 32 GB of memory under Windows 11: 45 to 55 seconds, with a peak of 135 to 315 MB of memory across runs. On Node.js 24 the same run reached about 510 MB. A generated site with about 400,000 findings finished in under 10 seconds with its files already read once, using up to 1.5 GB for SARIF, the largest format, and about 600 MB for JSON or HTML.
- **Failure:** locked files, denied reads, read-only and full output targets, a process killed partway through, and 70 or so hostile inputs of the kinds in `tests/failure.test.js`, on Windows and on Linux. See [SECURITY.md](SECURITY.md) for what it does and does not defend against.
- **Not run for real:** the workflow in `docs/ci.md` on GitHub Actions, and a SARIF upload to a code scanning service.

## Limits

These come with reading static files instead of running a browser:

- Pages and links that JavaScript creates at run time are not seen. Audit the output of a server-side or static render. A client-side application shell has little for this tool to read.
- Classes a script adds cannot be seen. CSS aimed only at such a class looks unused and is skipped; set `ignoreUnused` to `false` to check it. Text a stylesheet hides until a script changes an inline style looks hidden.
- Layout checks are arithmetic on class names and CSS values. They catch a grid whose gaps alone cannot fit and fixed widths, not every overflow a browser would show.
- Links to a path outside the base path are treated as another application on the same host, so they are not checked.
- Links to other hosts are not fetched, so a dead external link is not reported.
- Social image sizes are read for PNG and JPEG only. Other formats get no size check.
- `style/phone-overflow` knows Tailwind-style utility classes and plain CSS. Other class naming that carries a size in its name needs `classPatterns`.
- A text file over 32 MiB (mebibytes) is not read. The report names it and the exit code is 2. To accept that, list it under `ignore` in the config. Such a file still counts as existing for link checks.
- Memory grows with the size of the largest pages and with the number of findings. A very large site with a very large number of findings can run out of memory, which ends the run with a non-zero exit code and no report.

## How it works

`src/html/` is a tolerant hand-written tokenizer and tree builder, and `src/css/` is a simple scanner with a selector matcher and a cascade. None of them throws on broken input. They record source offsets, which is how findings get a line and column, even inside minified files and `style` attributes. The cascade works out what reaches an element on a page: the stylesheets it loads in order, `@import`, media queries, layers, specificity and `!important`. What depends on a width or a state, such as `:hover`, is kept apart from what always applies.

`src/site/` loads a build: pages, stylesheets, sitemaps, `robots.txt`, redirects, image sizes, and how a URL maps to a file. It makes one pass over the pages to learn what the site holds, and a second to run the rules, keeping one parsed page in memory at a time. `src/rules/` holds the rules, and `src/engine/` runs them, applies config and ignore comments, then sorts and removes duplicates. `src/report/` writes the formats.

A rule is a plain object with an `id`, a `severity`, a `description`, default `options`, and one or more of `page`, `stylesheet` and `site` functions that call `report()`. To add one, write the object and list it in `src/rules/index.js`, and config, docs checks and reports pick it up.

## Running the tests

Run the test suite:

```bash
npm test
```

Run the test suite, an end-to-end pass through the command line, and an install of the packed package:

```bash
sh check.sh
```

On Windows, run that from Git Bash, which comes with Git for Windows. Expected findings for the fixture sites in `tests/fixtures/` were written by hand in each `expected.json`, including a clean site that must produce none. A fixture's `llms.txt` is kept beside its site as `llms.fixture.txt`, and the tests add it to a temporary copy of the site.

## More

[CHANGELOG.md](CHANGELOG.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
