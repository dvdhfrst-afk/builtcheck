# Style

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

All three rules take `ignoreUnused` (default `true`), which skips CSS whose selector matches nothing on any page, such as the unused parts of a framework. A `<style>` block answers only for its own page. Selectors with states like `:hover` count as used when the element exists. A class that only a script adds looks unused, so set this to `false` to check everything. Selectors this tool cannot read are always checked.

The grid check is `(columns - 1) * gap > phoneWidth`. Classes that only apply at a larger breakpoint do not reach a phone, so `md:grid-cols-12 md:gap-10` is fine, and `grid-cols-12 gap-2 md:gap-10` is too. Classes such as `max-md:gap-10` do reach a phone. Hidden elements, positioned decoration, and anything inside a wrapper that scrolls or clips (by class, inline style or stylesheet) are not reported.

A CSS grid inside a `min-width` or `print` media query is not reported, and neither is one that a `max-width` query in the same source narrows or stops being a grid. A fixed width in CSS is checked against the elements it matches, through the cascade: another rule can replace it, cap it with `max-width`, take it out of flow, or hide the element. A `max-width` utility caps a width class, though not a `min-width` class.
