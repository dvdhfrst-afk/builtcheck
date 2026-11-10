# Web app manifest

Manifest rules check the web app manifest that pages link with `<link rel="manifest">`. Each manifest is checked once, however many pages link it. Its icons, `start_url` and `scope` resolve against the manifest's own address, as browsers resolve them.

| Rule | Default | Reports |
|---|---|---|
| `manifest/missing` | error | A page links a web app manifest that is not in the build. Reported once per manifest, at the first page that links it. |
| `manifest/invalid` | error | A linked manifest is not valid JSON (JavaScript Object Notation), or does not hold a JSON object. |
| `manifest/name` | error | A manifest has neither a `name` nor a `short_name`. |
| `manifest/icons` | error | An icon has no `src`, is not in the build, or is not the size its `sizes` declares. |
| `manifest/install-icons` | warning | A manifest that asks to be installed as an app has no icon of each size in `sizes`. |
| `manifest/scope` | error | `start_url` or `scope` points at another host or outside the base path, `start_url` leads to no built page, or `start_url` is outside the scope. |
| `manifest/colors` | error | `theme_color` or `background_color` is not a valid CSS color. |
| `manifest/display` | error | `display` is not one of `fullscreen`, `standalone`, `minimal-ui` or `browser`. |

Options:

- `manifest/install-icons`: `sizes` lists the square icon sizes in pixels an installable app needs (default 192 and 512). A manifest asks to be installed when `display` or an entry of `display_override` is an app mode such as `standalone`, rather than `browser`. Only icons for the `any` purpose count, since `maskable` icons are cut to a shape, and only their declared `sizes` count, since that is what browsers choose by. An icon declared as `any` size satisfies every size.

Icon sizes are read from the image files: PNG, JPEG, GIF, WebP, AVIF, HEIF, BMP and every size in an ICO file. SVG icons are scalable and match any declared size, and an icon on another host or in a format that cannot be read is not measured. Without `scope`, the scope is the folder the manifest is in. A `start_url` or `scope` on another host is reported only when the site's own host is known, from `site.url` or the sitemap.
