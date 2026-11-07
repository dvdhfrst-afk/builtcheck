// Runs rules over a site and collects findings.
//
// A rule is a plain object: { id, severity, description, options, page, stylesheet, site }.
// `page(page, context)` runs once per HTML page, `stylesheet(source, context)` once per CSS
// source (file, <style> block or style attribute) and `site(context)` once per run. Any of
// the three may be left out. Rules report through context.report() and hold no other state,
// which keeps them independent of each other and of how they are scheduled.

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
      const key = [rule.id, file, resolvedLine ?? NO_POSITION, resolvedColumn ?? NO_POSITION, message].join("\0");
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({
        rule: rule.id,
        severity: settings.severity,
        message,
        file,
        line: resolvedLine,
        column: resolvedColumn,
      });
    };

    const context = { site, options: settings.options, report };
    try {
      if (rule.site) rule.site(context);
      if (rule.page) {
        for (const page of site.pages) rule.page(page, context);
      }
      if (rule.stylesheet) {
        for (const source of site.styleSources) rule.stylesheet(source, context);
      }
    } catch (error) {
      throw new Error(`Rule ${rule.id} failed: ${error.stack ?? error.message}`);
    }
  }

  findings.sort(compareFindings);
  return { findings, suppressed };
}
