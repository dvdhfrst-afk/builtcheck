# Rule reference

Every rule has a default severity and can be turned off or changed in the config file. Everything below is a default, and any list of names, types, paths or patterns can be replaced. See the [README](../README.md#configuration) for the config format.

Pages are "indexable" when they are not an error page, do not ask not to be indexed, are not a redirect, and do not name a different page as canonical. A page that reloads itself with no target URL is not a redirect.

## Foundation

| Rule | Default | Reports |
|---|---|---|
| `foundation/robots-missing` | error | The build has no `robots.txt` at its root. |
| `foundation/robots-blocks-crawler` | error | `robots.txt` blocks a listed crawler from the home page, at the base path if there is one. |
| `foundation/robots-sitemap` | warning | `robots.txt` names no sitemap, or one that is relative, local or not in the build. |
| `foundation/llms-txt-missing` | warning | The build has no `llms.txt` at its root. |
| `foundation/llms-txt-invalid` | warning | `llms.txt` is empty or does not begin with a Markdown title line. |
| `foundation/sitemap-missing` | error | No sitemap at the configured paths or named in `robots.txt`. |
| `foundation/sitemap-invalid` | error | A sitemap cannot be read, lists nothing, or holds an entry that is not an absolute URL. An index naming a file not in the build counts too. |
| `foundation/sitemap-stale-url` | error | The sitemap lists a URL with no built page behind it. |
| `foundation/sitemap-host` | error | A sitemap URL points at a local address or a different host from the site. A `www.` prefix does not count as a different host. |
| `foundation/sitemap-noindex-url` | warning | The sitemap lists a page that asks not to be indexed or only redirects. |
| `foundation/sitemap-missing-page` | warning | An indexable page is missing from the sitemap. |
| `foundation/social-image-missing` | error | The build has no default social sharing image. |
| `foundation/social-image-size` | error | The default social image is not the configured size, or is not a valid PNG or JPEG. |
| `foundation/page-social-image` | warning | An indexable page has no `og:image`. |
| `foundation/page-social-image-broken` | error | A page names a social image that is not in the build. |
| `foundation/page-social-image-size` | warning | A page names its own PNG or JPEG social image at a size other than the configured one. |

Options:

- `foundation/robots-blocks-crawler`: `crawlers` is the list of user agent names (default: GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot, Google-Extended, Bytespider, CCBot, Applebot-Extended, cohere-ai, anthropic-ai). `requireExplicit` (default `false`), when true, also reports a crawler with no group of its own.
- `foundation/sitemap-missing-page`: `exclude` is a list of file globs that need no sitemap entry.
- `foundation/social-image-size` and `foundation/page-social-image-size`: `width` and `height` (default 1200 by 630).

The default social image is the first of `site.socialImagePaths` that exists. If none does, it is the image that the most pages name in `og:image`. Only PNG and JPEG sizes can be read, so an image in another format goes unmeasured.

## Structured data

| Rule | Default | Reports |
|---|---|---|
| `schema/invalid-json` | error | A JSON-LD block does not parse as JSON. |
| `schema/page-missing` | warning | An indexable page has no JSON-LD block. |
| `schema/missing-context` | error | A JSON-LD block has no schema.org `@context`. |
| `schema/missing-type` | error | A JSON-LD node has no `@type`. A node holding only an `@id` is a reference and needs none. |
| `schema/required-field` | error | A node lacks a field its type cannot do without, or is a breadcrumb other than the last with no link. Empty values count as missing. |
| `schema/recommended-field` | warning | A node lacks a field that makes its type more useful to search and answer engines. Empty values count as missing. |
| `schema/required-type` | error | An indexable page lacks a type listed in `types`. The default list is empty, so this does nothing until configured. |
| `schema/faq-content` | warning | A page with question and answer content has no `FAQPage` or `QAPage` node. |
| `schema/blog-post-article` | warning | A page under a blog path has no `Article` node or subtype. |

Options:

- `schema/required-field`: `required` maps a type to its fields. `a|b` means either field, and `a.b` looks inside a nested object. It merges by key, so you can change one type alone. `subtypes` maps a type to extra type names that count as it, beyond the built-in schema.org subtypes.

  | Type | Default required fields |
  |---|---|
  | LocalBusiness | name, address |
  | Service | name or serviceType |
  | FAQPage | mainEntity |
  | BreadcrumbList | itemListElement |
  | Article | headline |
  | SpeakableSpecification | cssSelector or xpath |
  | Question | name, acceptedAnswer or suggestedAnswer |
  | Answer | text |
  | ListItem | position, name or item.name |

- `schema/recommended-field`: `recommended` and `subtypes` work the same way.

  | Type | Default recommended fields |
  |---|---|
  | LocalBusiness | geo, areaServed, openingHoursSpecification |
  | Service | provider |
  | Article | author, datePublished |

- `schema/required-type`: `types` is the list of types every indexable page must carry. `subtypes` works as above.
- `schema/faq-content`: `minQuestions` (default 3) is how many headings that are questions, each followed by content, make a page question and answer content. Headings that are only a link, as on a listing page, do not count.
- `schema/blog-post-article`: `paths` lists file globs for blog posts (default `blog/**`, `posts/**`, `articles/**`, `news/**`). `listingPaths` lists file globs for listing pages under them, which are not posts.

Top-level nodes, `@graph` members and `mainEntity` are held to these requirements. Other nested nodes are often short references, so they are not, except speakable and answer objects, whose type is implied by where they sit.

## Links

| Rule | Default | Reports |
|---|---|---|
| `links/broken-internal` | error | An internal link does not resolve to a built file, `_redirects` rule or `site.externalPaths` entry. |
| `links/missing-anchor` | error | A link fragment or SVG `use` reference does not match any id on its target page. A `base` element changes which page that is. |
| `links/broken-asset` | error | An image, script, stylesheet, font or other referenced file is not in the build, including `srcset` and `imagesrcset` candidates, SVG `use` and `image`, and CSS `url()` and `@import`. An `img` or `script` with an empty `src` counts, unless it has lazy loading attributes. |
| `links/generic-no-destination` | error | A "Read more" style link has no href, a dead href, or a link to its own page. |
| `links/placeholder-href` | warning | Any other link with a placeholder href such as `#` that is not wired up as a control. |

Options:

- `links/generic-no-destination`: `phrases` lists the link texts, compared whole and ignoring case. An `aria-label` or image `alt` counts as the text. Elements marked as controls (`role="button"`, `aria-expanded`, `onclick`, `data-*-toggle`) are not reported.

Nothing inside a `template` element is checked, since a browser neither renders nor loads it.

## Copy

Copy rules read visible text only. They skip code and `pre` elements, scripts, styles, attributes, form values, hidden elements, SVG (Scalable Vector Graphics), `template` and `noscript`. Text a stylesheet always hides is skipped too, unless a rule aimed at the same class or id could show it: `.panel { display: none }` with `.panel.open { display: block }` counts as visible, because a script can add the class. A stylesheet that hides `html`, `body` or `main` does not count, since pages do that until a script runs.

| Rule | Default | Reports |
|---|---|---|
| `copy/em-dash` | warning | An em dash in visible text, written as a character or a reference. |
| `copy/double-hyphen` | warning | A `--` standing in for a dash. Command line flags, longer hyphen runs, text arrows, and URLs, domains and file names are not reported. |
| `copy/duplicate-heading` | warning | The same heading text twice on a page, ignoring case and spacing. Headings hidden at some breakpoints by classes or stylesheets, headings only for screen readers, and those in footers and navigation are not compared. |
| `copy/duplicate-subhead` | warning | A subhead or the first line after a heading says the same thing as the heading. |
| `copy/placeholder-text` | error | Leftover placeholder text in visible copy, image alt text or meta descriptions. |

Options:

- `copy/em-dash`: `characters` lists what counts. Add the en dash to report that as well.
- `copy/duplicate-heading` and `copy/duplicate-subhead`: `levels` lists the heading levels to compare (default 1, 2 and 3).
- `copy/placeholder-text`: `patterns` replaces the built-in list and `extraPatterns` adds to it. An entry is a regular expression string, or an object of `pattern`, `flags` and `label`. The built-in list covers lorem ipsum, unfinished markers, bracketed fill-ins, template wording, placeholder phone numbers and email addresses, unrendered templates and values.

## Style

Style rules read stylesheets in the build, `<style>` blocks and `style` attributes. Class-based checks read `class` attributes. Colors and fonts are read from CSS, not from class names: a compiled `bg-black` is caught in the stylesheet it compiles to.

| Rule | Default | Reports |
|---|---|---|
| `style/pure-color` | warning | Pure black or pure white in hex, name, `rgb()`, `hsl()`, `hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()` or `color()`. Translucent values are not reported. |
| `style/banned-font` | warning | A configured font is first in a font stack, is declared with `@font-face`, or is loaded from a web font service. |
| `style/phone-overflow` | error | A grid whose gaps alone are wider than the phone, or a fixed `width` or `min-width` wider than the phone. |

Options:

- `style/pure-color`: `ignoreProperties` lists custom properties to skip, with `*` as a wildcard (default `--tw-*`, which utility frameworks fill in for themselves). `ignoreFiles` lists file globs. `ignoreSelectors` lists text that marks a selector as third party widget styling (default `maplibregl-`, `mapboxgl-`, `leaflet-`). `ignoreUnused` is described below.
- `style/banned-font`: `fonts` lists the families (default Inter, Roboto, Helvetica, Open Sans). A family name matches with or without a `Variable` suffix, and `Inter Tight` is not `Inter`. `checkFallbacks` (default `false`) also reports fonts later in a stack. `ignoreFiles` lists file globs.
- `style/phone-overflow`: `phoneWidth` (default 390), `spacingUnit` (pixels per spacing step, default 4), `rootFontSize` (default 16). `classPatterns` adds class checks: each entry is a regular expression string, or an object of `pattern` and `message`. `ignoreUnused` is described below.

All three rules take `ignoreUnused` (default `true`), which skips CSS whose selector matches nothing on any page, such as the unused parts of a framework. Selectors with states like `:hover` count as used when the element exists. A class that only a script adds looks unused, so set this to `false` to check everything. Selectors this tool cannot read are always checked.

The grid check is `(columns - 1) * gap > phoneWidth`. Classes that only apply at a larger breakpoint do not reach a phone, so `md:grid-cols-12 md:gap-10` is fine, and `grid-cols-12 gap-2 md:gap-10` is too. Classes such as `max-md:gap-10` do reach a phone. Hidden elements, positioned decoration, and anything inside a wrapper that scrolls or clips (by class, inline style or stylesheet) are not reported.

A CSS grid inside a `min-width` or `print` media query is not reported, and neither is one that a `max-width` query in the same source narrows or stops being a grid. A fixed width in CSS is checked against the elements it matches, through the cascade: another rule can replace it, cap it with `max-width`, take it out of flow, or hide the element. A `max-width` utility caps a width class, though not a `min-width` class.
