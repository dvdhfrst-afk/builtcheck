# builtcheck

builtcheck audits a built static site folder such as `dist/`. It reads the files your build produced and reports the problems that page speed audits and link checkers leave out: a sitemap that disagrees with the pages, a social image of the wrong size, structured data missing the fields its type needs, "Read more" links that go nowhere, placeholder text that shipped, a grid that cannot fit on a phone.

It runs offline with no browser, does no network requests, never changes the site folder, and has no dependencies. It needs Node.js 18 or newer and nothing else: no install step and no build step.

## Quick start

From a clone of this repository, point it at a built folder:

```bash
node bin/builtcheck.js path/to/dist
```

Sample output:

```text
about/index.html
  6:1      warning  Social image /img/wide.png is 1200x675, expected 1200x630  foundation/page-social-image-size

extra.html
           warning  Page is not listed in the sitemap  foundation/sitemap-missing-page
  6:1      error    Social image /img/missing.png is not in the build  foundation/page-social-image-broken

robots.txt
  2        error    robots.txt blocks GPTBot from the site ("Disallow: /")  foundation/robots-blocks-crawler

sitemap.xml
  4:8      error    Sitemap lists https://www.example.com/gone/, but the build has no page there  foundation/sitemap-stale-url
  5:8      error    Sitemap URL points at a local address: http://localhost:4321/about/  foundation/sitemap-host

4 errors, 2 warnings in 4 pages, 0 stylesheets.
```

To add it to a build, run it after the build step and let the exit code fail the job. This repository is not published as a package, so keep a copy of it next to your project or inside it, and call `bin/builtcheck.js` by path.

| Exit code | Meaning |
|---|---|
| 0 | No errors, and warnings within any limit you set |
| 1 | Errors, or more warnings than `--max-warnings` allows |
| 2 | It could not run: a missing folder, a folder with no HTML (HyperText Markup Language) pages, a bad config file, a bad option |

A folder with no pages is exit code 2 on purpose, because it usually means the build did not run.

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

Severities follow one idea: an **error** means something is definitely broken or missing, and a **warning** means a recommendation or a style preference. Warnings do not fail a run unless you ask:

```bash
node bin/builtcheck.js dist --max-warnings 0
```

## Output formats

Text is the default. It collapses a finding repeated across many files, and caps one rule within one file, so a large report stays readable. Use `--all` to list everything, or `--quiet` to list errors only.

JSON (JavaScript Object Notation), for other tools. Each finding has `rule`, `severity`, `message`, `file`, `line` and `column`. `line` and `column` are `null` when a finding is about a whole file.

```bash
node bin/builtcheck.js dist --format json --output report.json
```

A single self-contained HTML report with filters by severity and rule:

```bash
node bin/builtcheck.js dist --format html --output report.html
```

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

To see every default, as a file you can start from:

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

When `url` is not set, the host is taken from the sitemap, `robots.txt` and canonical links. When `basePath` is not set, it is inferred from the sitemap if every URL shares a leading folder that is not in the build and removing it finds the pages. A `_redirects` file in the build counts: a path it redirects is a valid link, with or without the base path in its source.

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

Each report gives a count of the findings ignored this way.

## How it works

`src/html/` is a tolerant hand-written tokenizer and tree builder, and `src/css/` is a simple scanner with a selector matcher and a cascade. None of them throws on broken input. They record source offsets, which is how findings get a line and column, even inside minified files and `style` attributes. The cascade works out what reaches an element on a page: the stylesheets it loads in order, `@import`, media queries, layers, specificity and `!important`. What depends on a width or a state, such as `:hover`, is kept apart from what always applies.

`src/site/` loads a build: pages, stylesheets, sitemaps, `robots.txt`, redirects, image sizes, and how a URL maps to a file. `src/rules/` holds the rules, and `src/engine/` runs them, applies config and ignore comments, then sorts and removes duplicates. `src/report/` writes the three formats.

A rule is a plain object with an `id`, a `severity`, a `description`, default `options`, and one or more of `page`, `stylesheet` and `site` functions that call `report()`. To add one, write the object and list it in `src/rules/index.js`, and config, docs checks and reports pick it up.

## Limits

These come with reading static files instead of running a browser:

- Pages and links that JavaScript creates at run time are not seen. Audit the output of a server-side or static render.
- Classes a script adds cannot be seen. CSS aimed only at such a class looks unused and is skipped; set `ignoreUnused` to `false` to check it. Text a stylesheet hides until a script changes an inline style looks hidden.
- Layout checks are arithmetic on class names and CSS values. They catch a grid whose gaps alone cannot fit and fixed widths, not every overflow a browser would show.
- Links to a path outside the base path are treated as another application on the same host, so they are not checked.
- Links to other hosts are not fetched.
- Social image sizes are read for PNG and JPEG only. Other formats get no size check.
- `style/phone-overflow` knows Tailwind-style utility classes and plain CSS. Other class naming that carries a size in its name needs `classPatterns`.

## Running the tests

Run the test suite:

```bash
npm test
```

Run the test suite and an end-to-end pass through the command line:

```bash
sh check.sh
```

Expected findings for the fixture sites in `tests/fixtures/` were written by hand in each `expected.json`, including a clean site that must produce none. A fixture's `llms.txt` is kept beside its site as `llms.fixture.txt`, and the tests add it to a temporary copy of the site.

## License

MIT. See [LICENSE](LICENSE).
