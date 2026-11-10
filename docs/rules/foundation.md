# Foundation

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
