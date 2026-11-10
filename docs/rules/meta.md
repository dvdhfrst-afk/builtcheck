# Page metadata

What a page tells browsers, search engines and social sites about itself: its title and description, canonical URL, top heading, viewport, character encoding, icons and share card.

| Rule | Default | Reports |
|---|---|---|
| `meta/title-missing` | error | A page has no `title` element, or an empty one. A `title` inside SVG (Scalable Vector Graphics) is a tooltip and does not count. |
| `meta/title-length` | warning | An indexable page has a title shorter than `minLength` or longer than `maxLength` characters. |
| `meta/title-duplicate` | warning | Several indexable pages share one title, ignoring case and spacing. One finding per group, on the first page, naming the others. |
| `meta/description-missing` | warning | An indexable page has no meta description, or an empty one. |
| `meta/description-length` | warning | An indexable page has a meta description longer than `maxLength` characters. |
| `meta/description-duplicate` | warning | Several indexable pages share one meta description. One finding per group, as for titles. |
| `meta/canonical-multiple` | error | A page has more than one canonical link and they name different URLs. Repeating the same URL is not reported. |
| `meta/canonical-invalid` | error | A canonical link has no href, is not a web address, is only a fragment, points at a local address such as `localhost`, or sits in the body, where search engines ignore it. |
| `meta/canonical-relative` | warning | A canonical link uses a relative URL instead of an absolute one. |
| `meta/canonical-target` | error | A canonical link names a page on this site that is not in the build, redirects, asks not to be indexed, is an error page, or names yet another page as its canonical. |
| `meta/canonical-host` | warning | A canonical link names a different host from the site, or the other scheme (`http` or `https`) from `site.url`. Only checked when the site host is known. |
| `meta/h1-missing` | warning | An indexable page has no visible `h1` heading. |
| `meta/h1-multiple` | warning | An indexable page has more than one visible `h1` heading. |
| `meta/viewport-missing` | warning | A page has no viewport meta tag, so phones show it zoomed out at desktop width. |
| `meta/viewport-zoom` | error | The viewport meta tag stops people from zooming in: `user-scalable=no`, or a `maximum-scale` below `minMaximumScale`. |
| `meta/charset` | warning | A page declares no character encoding, declares it after the first 1024 bytes where browsers look for it, or declares one other than UTF-8. A byte order mark counts as a declaration. |
| `meta/favicon-missing` | warning | The site has no favicon: no `favicon.ico` at the root of the build, and no page links an icon that exists. |
| `meta/icon-broken` | error | An `icon`, `apple-touch-icon` or `mask-icon` link names a file that is missing, empty or not an image, or a touch icon in SVG or ICO format, which iPhones and iPads do not use. |
| `meta/og-missing` | warning | An indexable page lacks an Open Graph property listed in `properties`. |
| `meta/og-url` | warning | `og:url` is not an absolute URL, or names a different URL from the canonical link. |
| `meta/twitter-card` | warning | `twitter:card` is empty or not one of `values`. |

Options:

- `meta/title-length`: `minLength` (default 10) and `maxLength` (default 60), counted in characters after collapsing spaces.
- `meta/description-length`: `maxLength` (default 160).
- `meta/title-duplicate` and `meta/description-duplicate`: `exclude` is a list of file globs left out of the comparison, such as `blog/page/**` for numbered listing pages.
- `meta/viewport-zoom`: `minMaximumScale` (default 2) is the lowest `maximum-scale` that still lets people zoom far enough to read.
- `meta/og-missing`: `properties` (default `og:title` and `og:description`) lists the properties every indexable page needs. A property with empty content counts as missing. `og:image` is checked by `foundation/page-social-image`.
- `meta/twitter-card`: `values` (default `summary`, `summary_large_image`, `app` and `player`) lists the accepted card types, compared ignoring case.

Head rules skip files that are not whole documents (no `html`, `head`, `body` or `title` element and no doctype), pages that only redirect, and error pages. Headings count as visible by the same rules the copy rules use: hidden elements, `template` and `noscript` do not count, and neither does a heading a stylesheet always hides. A heading for screen readers only still counts. An `h1` shown only at some screen widths is not counted twice with its copy for the other widths. An `h1` holding only an image counts when the image has alt text.

When `links/broken-internal` is on, it reports a canonical link that is not a valid URL or names a missing page, and when `links/broken-asset` is on, it reports a missing icon file, so each fault is reported once.
