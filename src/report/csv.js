// CSV as RFC 4180 describes it: a header row, one finding per row, CRLF line ends, and quotes
// around any field holding a comma, a quote or a line break. Text from the audited site may be
// hostile, and a spreadsheet runs a cell that starts with = + - @ (or a tab or carriage return
// before one) as a formula, so such a cell gets a leading apostrophe and is read as text.

import { printable } from "./printable.js";

const COLUMNS = ["file", "line", "column", "severity", "rule", "message"];
const FORMULA_START = /^[=+\-@\t\r]/;

function field(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  let text = printable(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function formatCsv(result) {
  const rows = [COLUMNS.join(",")];
  for (const finding of result.findings) rows.push(COLUMNS.map((column) => field(finding[column])).join(","));
  return `${rows.join("\r\n")}\r\n`;
}
