# Copy

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
