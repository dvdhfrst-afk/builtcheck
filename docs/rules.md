# Rule reference

Every rule has a default severity and can be turned off or changed in the config file. Everything below is a default, and any list of names, types, paths or patterns can be replaced. See the [README](../README.md#configuration) for the config format.

Pages are "indexable" when they are not an error page or an application's fallback shell (a file named `404`, `500`, `200`, `fallback`, `not-found` or `error`, with or without a leading underscore), do not ask not to be indexed, are not a redirect, and do not name a different page as canonical. A page that reloads itself with no target URL is not a redirect.

Each group has its own page, with a table of its rules and their options.

| Group | Rule ids | Page |
|---|---|---|
| Foundation | `foundation/*` | [foundation](rules/foundation.md) |
| Page metadata | `meta/*` | [meta](rules/meta.md) |
| Languages and alternate versions | `i18n/*` | [i18n](rules/i18n.md) |
| Structured data | `schema/*` | [schema](rules/schema.md) |
| Links | `links/*` | [links](rules/links.md) |
| Assets | `assets/*` | [assets](rules/assets.md) |
| Feeds | `feeds/*` | [feeds](rules/feeds.md) |
| Web app manifest | `manifest/*` | [manifest](rules/manifest.md) |
| Copy | `copy/*` | [copy](rules/copy.md) |
| Style | `style/*` | [style](rules/style.md) |
