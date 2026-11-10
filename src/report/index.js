// Every report format, by the name `--format` takes. A format renders the object audit() returns.
//
// `render(result, context)` returns the whole report as a string. `context` holds:
//   rules     the rule objects of this run, for formats that describe them
//   color     whether text may use terminal colors
//   showAll   list every finding with nothing collapsed (text only)
//   quiet     list errors only (text only)

import { formatCheckstyle } from "./checkstyle.js";
import { formatCodeclimate } from "./codeclimate.js";
import { formatCsv } from "./csv.js";
import { formatGithub } from "./github.js";
import { formatHtml } from "./html.js";
import { formatJson } from "./json.js";
import { formatJunit } from "./junit.js";
import { formatMarkdown } from "./markdown.js";
import { formatSarif } from "./sarif.js";
import { formatText } from "./text.js";

export const FORMATS = {
  text: { description: "Readable report for a terminal (default)", render: (result, context) => formatText(result, context) },
  json: { description: "The full result as JSON, for other tools", render: (result) => formatJson(result) },
  html: { description: "One self-contained HTML page with filters", render: (result, context) => formatHtml(result, context.rules) },
  github: { description: "GitHub Actions workflow annotations", render: (result) => formatGithub(result) },
  sarif: { description: "SARIF 2.1.0 for code scanning services", render: (result, context) => formatSarif(result, context.rules) },
  markdown: { description: "Markdown for a pull request comment", render: (result, context) => formatMarkdown(result, context.rules) },
  junit: { description: "JUnit XML test report for GitLab, Jenkins, Azure and other CI", render: (result, context) => formatJunit(result, context.rules) },
  csv: { description: "One finding per row, for a spreadsheet", render: (result) => formatCsv(result) },
  codeclimate: { description: "Code Climate JSON, read by GitLab as a code quality report", render: (result) => formatCodeclimate(result) },
  checkstyle: { description: "Checkstyle XML, read by many CI plugins", render: (result) => formatCheckstyle(result) },
};

export const FORMAT_NAMES = Object.keys(FORMATS);

// "text, json, html, github, sarif, ... or checkstyle"
export function formatList() {
  const names = [...FORMAT_NAMES];
  const last = names.pop();
  return names.length > 0 ? `${names.join(", ")} or ${last}` : last;
}
