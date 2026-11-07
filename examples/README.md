# A worked example

`before/` and `after/` are the same invented bakery, as a build would leave it. All of it is made up, and every URL is on `example.com`. Run these from the top folder of the repository.

## Before

```bash
node bin/builtcheck.js examples/before --no-config
```

The run exits with code 1 and ends with:

```text
15 errors, 14 warnings in 3 pages, 1 stylesheet.
copy/double-hyphen, style/pure-color, style/banned-font: style preferences, not faults. To leave them out: --skip copy/double-hyphen,style/pure-color,style/banned-font
```

The kinds of problem it finds, and what fixing each one took in `after/`:

| Finding | Rule | The fix |
|---|---|---|
| `robots.txt` shuts out one crawler | `foundation/robots-blocks-crawler` | Removed the block |
| The sitemap lists a page that was never built, and a `localhost` address | `foundation/sitemap-stale-url`, `foundation/sitemap-host` | Listed the real pages at the real host |
| A blog post is not in the sitemap | `foundation/sitemap-missing-page` | Listed it |
| The default social image is 1200 by 675 | `foundation/social-image-size` | Remade it at 1200 by 630 |
| A page names a social image that is not there | `foundation/page-social-image-broken` | Pointed it at the real one |
| Structured data lacks a context or an address | `schema/missing-context`, `schema/required-field` | Filled them in |
| A link to a page, a link to an anchor and an image that do not exist | `links/broken-internal`, `links/missing-anchor`, `links/broken-asset` | Fixed the links, added the anchor and the image |
| "Read more" goes nowhere | `links/generic-no-destination` | Gave it a destination |
| Lorem ipsum in a description, and "Your text here." on a page | `copy/placeholder-text` | Wrote the text |
| A grid with 12 columns and 40 pixel gaps at every width | `style/phone-overflow` | Moved it under a `min-width` media query |
| Pure black, and Inter as the first font | `style/pure-color`, `style/banned-font` | Style preferences: changed here, but yours to decide |

To see the report as a page instead, write it outside the site folder:

```bash
node bin/builtcheck.js examples/before --no-config --format html --output before-report.html
```

## After

```bash
node bin/builtcheck.js examples/after --config examples/after.config.json
```

```text
No problems found in 3 pages, 1 stylesheet.
```

The exit code is 0. This site has no `llms.txt`, and [after.config.json](after.config.json) turns off the one rule that asks for it. That is how you tell builtcheck that a check does not apply to your site.

## The other config

[builtcheck.config.json](builtcheck.config.json) is not for these sites. It shows a realistic set of settings for a larger one, and asks for fields the bakery does not have.
