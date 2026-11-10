// Every report format, by the name `--format` takes. A format renders the object audit() returns.
//
// `render(result, context)` returns the whole report as a string. `context` holds:
//   rules     the rule objects of this run, for formats that describe them
//   color     whether text may use terminal colors
//   showAll   list every finding with nothing collapsed (text only)
//   quiet     list errors only (text only)

import { formatGithub } from "./github.js";
import { formatHtml } from "./html.js";
import { formatJson } from "./json.js";
import { formatSarif } from "./sarif.js";
import { formatText } from "./text.js";

export const FORMATS = {
  text: { description: "Readable report for a terminal (default)", render: (result, context) => formatText(result, context) },
  json: { description: "The full result as JSON, for other tools", render: (result) => formatJson(result) },
  html: { description: "One self-contained HTML page with filters", render: (result) => formatHtml(result) },
  github: { description: "GitHub Actions workflow annotations", render: (result) => formatGithub(result) },
  sarif: { description: "SARIF 2.1.0 for code scanning services", render: (result, context) => formatSarif(result, context.rules) },
};

export const FORMAT_NAMES = Object.keys(FORMATS);

// "text, json, html, github or sarif"
export function formatList() {
  const names = [...FORMAT_NAMES];
  const last = names.pop();
  return names.length > 0 ? `${names.join(", ")} or ${last}` : last;
}
