# Contributing

Bug reports and changes are welcome through the repository you got this from. No dependencies and no build step, so all you need is Node.js 18 or newer.

## Reporting a false alarm or a miss

A false alarm is the most useful report there is. Include the smallest HTML or CSS that shows it, the rule id, and what you expected. Please invent the content: do not paste private site material, and use `example.com` for addresses.

## Making a change

1. Run the tests first, so you know they pass before you start:

   ```bash
   npm test
   ```

2. Add a test that fails without your change. Rule tests live in `tests/rules.test.js`, and failure handling in `tests/failure.test.js`. A fixture site's `expected.json` is written by hand, not generated from the output.
3. Before you finish, run the full check, which also packs and installs the package:

   ```bash
   sh check.sh
   ```

## Adding a rule

A rule is a plain object in `src/rules/`, listed in `src/rules/index.js`. It needs an `id`, a `severity`, a `description`, default `options`, and one or more of `page`, `stylesheet` and `site`. Document it in `docs/rules.md`; a test checks that you did.

- **Error or warning?** An error means definitely broken or missing. If a reasonable site could do this on purpose, it is a warning.
- **Stay quiet when unsure.** A rule that cannot be sure it has found a problem should say nothing. One false alarm costs more trust than one missed finding.
- **Take untrusted input seriously.** Pages can be huge and hostile. Avoid regular expressions built from page text, and anything quadratic in the size of a page.

## Style

- Plain JavaScript in ES modules, with no runtime dependencies.
- No literal em or en dashes in any file: a test checks this. Write them as a Unicode escape in code, and use a comma, colon or parentheses in prose.
- In documentation, give each command its own code block with no chained commands, so it can be copied and run in any shell. Spell out an acronym the first time a page uses it.
- Numbers in the README come from a run you did, on a setup you state.
