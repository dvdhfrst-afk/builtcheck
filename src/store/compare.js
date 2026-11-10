// What changed between two results. A finding is the same finding in both when its rule, file and
// message match, so one whose line moved because content above it changed is not reported as
// fixed in one place and new in another. Where a file holds several such findings, they pair on
// the same position first and then in order, which keeps nearby ones together.

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byPosition(a, b) {
  return compareText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) || compareText(a.rule, b.rule) || compareText(a.message, b.message);
}

const at = (finding) => `${finding.line ?? ""}:${finding.column ?? ""}`;

// Pairs the findings of one rule, file and message. Returns { pairs, gone, added }.
function pairUp(older, newer) {
  const sortedOlder = [...older].sort(byPosition);
  const sortedNewer = [...newer].sort(byPosition);
  const unpairedAt = new Map();
  sortedOlder.forEach((finding, index) => {
    if (!unpairedAt.has(at(finding))) unpairedAt.set(at(finding), []);
    unpairedAt.get(at(finding)).push(index);
  });
  const used = new Set();
  const matched = new Map();
  sortedNewer.forEach((finding, index) => {
    const candidates = unpairedAt.get(at(finding));
    if (candidates?.length > 0) {
      const partner = candidates.shift();
      used.add(partner);
      matched.set(index, partner);
    }
  });
  const restOlder = sortedOlder.map((_, index) => index).filter((index) => !used.has(index));
  const pairs = [];
  const added = [];
  sortedNewer.forEach((finding, index) => {
    if (matched.has(index)) pairs.push([sortedOlder[matched.get(index)], finding]);
    else if (restOlder.length > 0) pairs.push([sortedOlder[restOlder.shift()], finding]);
    else added.push(finding);
  });
  return { pairs, gone: restOlder.map((index) => sortedOlder[index]), added };
}

function groupByIdentity(findings, side, groups) {
  for (const finding of findings) {
    const key = `${finding.rule}\0${finding.file}\0${finding.message}`;
    if (!groups.has(key)) groups.set(key, { before: [], after: [] });
    groups.get(key)[side].push(finding);
  }
}

// `before` and `after` are upgraded results. Returns the changes, with findings in report order:
//   summary  counts in each run, and how many findings are new, gone and still present
//   rules    per rule: findings before and after, and how many are new and gone
//   added, gone, still   the findings; each entry of still is the later finding with `previous`,
//            its position and severity in the earlier run
export function compareResults(before, after) {
  const groups = new Map();
  groupByIdentity(before.findings, "before", groups);
  groupByIdentity(after.findings, "after", groups);
  const added = [];
  const gone = [];
  const still = [];
  for (const group of groups.values()) {
    const paired = pairUp(group.before, group.after);
    added.push(...paired.added);
    gone.push(...paired.gone);
    for (const [older, newer] of paired.pairs) {
      still.push({ ...newer, previous: { line: older.line, column: older.column, severity: older.severity } });
    }
  }
  for (const list of [added, gone, still]) list.sort(byPosition);

  const rules = new Map();
  const tally = (rule) => {
    if (!rules.has(rule)) rules.set(rule, { rule, before: 0, after: 0, added: 0, gone: 0 });
    return rules.get(rule);
  };
  for (const finding of before.findings) tally(finding.rule).before += 1;
  for (const finding of after.findings) tally(finding.rule).after += 1;
  for (const finding of added) tally(finding.rule).added += 1;
  for (const finding of gone) tally(finding.rule).gone += 1;

  const counts = (result) => ({ errors: result.summary.errors, warnings: result.summary.warnings, pages: result.summary.pages, complete: result.complete });
  return {
    summary: {
      before: counts(before),
      after: counts(after),
      added: added.length,
      gone: gone.length,
      still: still.length,
      severityChanged: still.filter((finding) => finding.previous.severity !== finding.severity).length,
    },
    rules: [...rules.values()].filter((entry) => entry.added > 0 || entry.gone > 0).sort((a, b) => compareText(a.rule, b.rule)),
    added,
    gone,
    still,
  };
}
