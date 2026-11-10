# Assets

Asset rules look at the files a build publishes and how its pages load them: their weight, image sizes, render-blocking scripts, font loading and insecure loads. Sizes are measured on disk, before any compression a server adds, and a kilobyte (KB) here is 1,024 bytes. Files that `ignore` in the config matches are left out.

| Rule | Default | Reports |
|---|---|---|
| `assets/large-image` | warning | An image file is larger than the byte budget. |
| `assets/large-stylesheet` | warning | A stylesheet file is larger than the byte budget. |
| `assets/large-script` | warning | A script file is larger than the byte budget. |
| `assets/duplicate-file` | warning | The same file content is published under several paths, reported once per group of identical files. |
| `assets/img-missing-dimensions` | warning | An `img` has no `width` and `height` attributes, and no CSS gives it an aspect ratio or both dimensions, so the page shifts as it loads. |
| `assets/oversized-image` | warning | An image has far more pixels than the size it is shown at needs, counting `srcset` candidates. |
| `assets/page-weight` | warning | A page and the CSS, scripts, fonts and images it loads from the build weigh more than the budget. |
| `assets/render-blocking-script` | warning | A script in `head` loads without `async`, `defer` or `type="module"`, so nothing shows until it has downloaded and run. |
| `assets/font-display` | warning | An `@font-face` rule has no `font-display`, so text can stay invisible while the font loads. |
| `assets/mixed-content` | error | An HTTPS (secure HTTP) site loads a script, stylesheet, image or other subresource over plain `http:`. |

Options:

- `assets/large-image`: `maxKilobytes` (default 500). Images are recognized by file extension: PNG, JPEG, GIF, WebP, AVIF, HEIF, SVG (Scalable Vector Graphics), ICO, BMP, TIFF and JPEG XL.
- `assets/large-stylesheet`: `maxKilobytes` (default 200).
- `assets/large-script`: `maxKilobytes` (default 500), for `.js`, `.mjs` and `.cjs` files.
- `assets/duplicate-file`: `minKilobytes` (default 1) is the smallest file worth reporting. Only images, stylesheets, scripts, fonts, audio, video, PDF and zip files are compared, never pages or text files. `favicon.ico` and `apple-touch-icon.png` at the root are left out, since browsers ask for them there whatever the pages say.
- `assets/oversized-image`: `ratio` (default 3) is how many times larger than its display size an image may be. The display size is the `width` attribute, or a pixel `width` the stylesheets always give it, or failing those the height. The default leaves room for screens of two and three times the usual pixel density.

How `assets/img-missing-dimensions` decides: an image with both attributes is fine. Otherwise CSS counts if any rule that could match the image sets `aspect-ratio`, or sets both a width and a height (`width` or `inline-size`, `height` or `block-size`) to something other than `auto`. Rules that apply only at some widths count too. Images that are hidden, positioned `absolute` or `fixed`, inside `noscript` or `template`, or that have no source are not reported.

How `assets/oversized-image` counts `srcset`: with density descriptors such as `2x`, each candidate is compared with the display size times its density, and the plain `src` counts as `1x`. With width descriptors such as `480w`, the browser picks by screen, so only the smallest candidate is checked: if even it is more than `ratio` times the display width, every screen gets too many pixels. Vector images, icon files, images on other hosts and files under 16 KB are not reported, and `picture` `source` elements are not compared, since art direction can show them at other sizes.

How `assets/page-weight` counts: the page's HTML, each stylesheet it links or imports, each script, each image (the `src`, or one `srcset` candidate when there is no `src`), `rel="preload"` files, icons, and the first font file of each `@font-face` in the stylesheets it loads. Each file counts once per page. Files on other hosts, CSS background images, audio and video are not counted, because the build cannot say how large they are or whether they load at all. `maxKilobytes` (default 3072, which is 3 MB) is the budget.

How `assets/mixed-content` knows the site is served over HTTPS: from `site.url`, or else from whether most of the sitemap and canonical URLs for its own host use `https:`. If nothing says, it reports nothing. Addresses on `localhost` count as secure, as browsers treat them. Links (`a href`) are navigation, not subresources, and are not reported.
