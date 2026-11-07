// Runs rules over a site and collects findings.
//
// A rule is a plain object: { id, severity, description, options, page, stylesheet, site }.
// `site(context)` runs once per run, first. `page(page, context)` runs once per HTML page, and
// `stylesheet(source, context)` once per CSS source (file, <style> block or style attribute).
// A page's blocks and style attributes are visited along with the page and stylesheet files
// after all the pages. Any of the three may be left out. A rule that fails on odd input does
// not lose the rest of the audit: the failure is recorded and makes the run incomplete.

import { detached } from "../html/page.js";

const NO_POSITION = Number.MAX_SAFE_INTEGER;

function compareFindings(a, b) {
  return (
    (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) ||
    (a.message < b.message ? -1 : a.message > b.message ? 1 : 0)
  );
}

export function runRules(site, config, rules) {
  const findings = [];
  const seen = new Set();
  let suppressed = 0;
  const active = [];

  for (const rule of rules) {
    const settings = config.rules[rule.id];
    if (settings.severity === "off") continue;

    const report = ({ file, offset = null, line = null, column = null, message }) => {
      let resolvedLine = line;
      let resolvedColumn = column;
      if (offset !== null) {
        const position = site.lineIndexFor(file)?.locate(offset);
        if (position) {
          resolvedLine = position.line;
          resolvedColumn = position.column;
        }
      }
      if (site.suppressionsFor(file).matches(rule.id, resolvedLine, offset)) {
        suppressed += 1;
        return;
      }
      const key = detached([rule.id, file, resolvedLine ?? NO_POSITION, resolvedColumn ?? NO_POSITION, message].join("\0"));
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({
        rule: rule.id,
        severity: settings.severity,
        message: detached(message),
        file,
        line: resolvedLine,
        column: resolvedColumn,
      });
    };

    active.push({ rule, context: { site, options: settings.options, report } });
  }

  const guarded = (rule, file, run) => {
    try {
      run();
    } catch (error) {
      if (process.env.BUILTCHECK_DEBUG) process.stderr.write(`${error.stack ?? error.message}\n`);
      site.skip(file, `rule ${rule.id} failed here: ${error.message}`, true);
    }
  };

  for (const { rule, context } of active) {
    if (rule.site) guarded(rule, "(site)", () => rule.site(context));
  }
  const needsPages = active.some(({ rule }) => rule.page || rule.stylesheet);
  if (needsPages) {
    for (const page of site.eachPage()) {
      for (const { rule, context } of active) {
        if (rule.page) guarded(rule, page.file, () => rule.page(page, context));
        if (rule.stylesheet) {
          for (const source of page.styleSources) guarded(rule, page.file, () => rule.stylesheet(source, context));
        }
      }
    }
  }
  for (const source of site.stylesheets) {
    for (const { rule, context } of active) {
      if (rule.stylesheet) guarded(rule, source.file, () => rule.stylesheet(source, context));
    }
  }

  findings.sort(compareFindings);
  return { findings, suppressed };
}
