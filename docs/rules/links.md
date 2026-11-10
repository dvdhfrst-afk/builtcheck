# Links

| Rule | Default | Reports |
|---|---|---|
| `links/broken-internal` | error | An internal link does not resolve to a built file, `_redirects` rule or `site.externalPaths` entry. |
| `links/missing-anchor` | error | A link fragment or SVG `use` reference does not match any id on its target page. A `base` element changes which page that is. |
| `links/broken-asset` | error | An image, script, stylesheet, font or other referenced file is not in the build, including `srcset` and `imagesrcset` candidates, SVG `use` and `image`, and CSS `url()` and `@import`. An `img` or `script` with an empty `src` counts, unless it has lazy loading attributes. |
| `links/generic-no-destination` | error | A "Read more" style link has no href, a dead href, or a link to its own page. |
| `links/placeholder-href` | warning | Any other link with a placeholder href such as `#` that is not wired up as a control. |
| `links/outside-base-path` | warning | Over half of the root-relative links and files sampled from the pages lie outside the base path. Those are treated as another application and not checked, so a wrong base path would otherwise hide broken links. |

Options:

- `links/generic-no-destination`: `phrases` lists the link texts, compared whole and ignoring case. An `aria-label` or image `alt` counts as the text. Elements marked as controls (`role="button"`, `aria-expanded`, `onclick`, `data-*-toggle`) are not reported.

Nothing inside a `template` element is checked, since a browser neither renders nor loads it.
