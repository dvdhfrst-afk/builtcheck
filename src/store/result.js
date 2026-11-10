// Saved results from any version of builtcheck, brought to the shape this version reads. Every
// reader of saved results goes through upgradeResult(), so an older result needs no special case
// anywhere else, and a later result version adds one step here.

import { RESULT_VERSION } from "../audit.js";
import { StoreError } from "./files.js";

// STEPS[n] turns a result of version n into one of version n + 1. Version 1 is still current,
// so there are none yet; a change to the result's fields adds its step under the old version.
const STEPS = {};

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function looksLikeResult(value) {
  return isObject(value) && value.tool === "builtcheck" && Array.isArray(value.findings) && isObject(value.summary);
}

const count = (value, fallback) => (Number.isInteger(value) && value >= 0 ? value : fallback);

function checkedFinding(finding, index, where) {
  const position = (value) => (value === undefined || value === null ? null : value);
  const valid =
    isObject(finding) &&
    ["rule", "severity", "message", "file"].every((key) => typeof finding[key] === "string") &&
    [finding.line, finding.column].every((value) => value === undefined || value === null || (Number.isInteger(value) && value >= 0));
  if (!valid) throw new StoreError(`${where} is damaged: finding ${index + 1} is not in the shape of a builtcheck finding.`);
  return { ...finding, line: position(finding.line), column: position(finding.column) };
}

// Fields the current version has that results of the same version may lack, because results
// may gain fields at any time and early ones were written before these existed.
function completed(result, where) {
  const findings = result.findings.map((finding, index) => checkedFinding(finding, index, where));
  const skipped = Array.isArray(result.skipped) ? result.skipped.filter((entry) => isObject(entry) && typeof entry.file === "string") : [];
  const summary = result.summary;
  const counted = (severity) => findings.filter((finding) => finding.severity === severity).length;
  const pages = count(summary.pages, 0);
  return {
    ...result,
    resultVersion: RESULT_VERSION,
    version: typeof result.version === "string" ? result.version : "unknown",
    root: typeof result.root === "string" ? result.root : "",
    site: isObject(result.site) ? result.site : { host: null, basePath: "/" },
    // Results from before "complete" existed did not record unread files either, so all that is
    // known is whether there were pages.
    complete: typeof result.complete === "boolean" ? result.complete : pages > 0,
    summary: {
      ...summary,
      errors: count(summary.errors, counted("error")),
      warnings: count(summary.warnings, counted("warning")),
      suppressed: count(summary.suppressed, 0),
      pages,
      stylesheets: count(summary.stylesheets, 0),
      files: count(summary.files, 0),
    },
    findings,
    skipped,
  };
}

// `where` names the source in messages, such as "Run 20261109-101500-000" or "report.json".
export function upgradeResult(value, where) {
  if (!looksLikeResult(value)) throw new StoreError(`${where} is not a builtcheck JSON report.`);
  // Results from before the field existed are version 1.
  const from = value.resultVersion ?? 1;
  if (!Number.isInteger(from) || from < 1) throw new StoreError(`${where} is damaged: its resultVersion is not a version number.`);
  if (from > RESULT_VERSION) {
    throw new StoreError(`${where} was written by a newer builtcheck (result version ${from}). This version reads result version ${RESULT_VERSION} and older, so update builtcheck to read it.`);
  }
  let result = value;
  for (let version = from; version < RESULT_VERSION; version += 1) result = STEPS[version](result);
  return completed(result, where);
}
