// The page the browser loads, and the files it loads from this server. Every file served is on a
// fixed list: nothing from the site or the store folder is ever served as a file, only through
// the API.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { printable } from "../report/printable.js";
import { escapeHtml } from "./web/html.js";

// The browser modules import each other by relative paths, and one imports
// src/report/printable.js, so they are served under /static/ at their paths below src/. The
// same imports then work in the browser and in tests under Node.
const SOURCE = new URL("../", import.meta.url);

const STATIC_FILES = [
  "server/web/app.js",
  "server/web/html.js",
  "server/web/format.js",
  "server/web/chart.js",
  "server/web/views.js",
  "server/web/style.css",
  "server/web/icon.svg",
  "report/printable.js",
];

const TYPES = {
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
};

// The file for a path under /static/, or null for any path not on the list.
export function staticFile(path) {
  const name = path.slice("/static/".length);
  if (!path.startsWith("/static/") || !STATIC_FILES.includes(name)) return null;
  return { body: readFileSync(fileURLToPath(new URL(name, SOURCE))), type: TYPES[name.split(".").pop()] };
}

// The paths the page itself answers; the browser module decides what each shows.
export function isPagePath(path) {
  return path === "/" || path === "/compare" || path === "/rules" || /^\/runs\/[^/]+$/.test(path) || /^\/rules\/[^/]+\/[^/]+$/.test(path);
}

const text = (value) => escapeHtml(printable(value));

// `token` is the per-server token POST requests carry; `store` and `site` are the folders as
// given on the command line, which may hold any character a folder name can.
export function pageHtml({ token, store, site }) {
  const siteLine = site ? ` <span aria-hidden="true">|</span> Site <code>${text(site)}</code>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="builtcheck-token" content="${escapeHtml(token)}">
<title>builtcheck</title>
<link rel="icon" href="/static/server/web/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/server/web/style.css">
<script type="module" src="/static/server/web/app.js"></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top">
<p class="brand"><a href="/">builtcheck</a></p>
<nav aria-label="Main"><ul><li><a href="/">Runs</a></li><li><a href="/compare">Compare</a></li><li><a href="/rules">Rules</a></li></ul></nav>
<p class="where">Store <code>${text(store)}</code>${siteLine}</p>
</header>
<div id="status" class="status" role="status" aria-live="polite"></div>
<main id="main" tabindex="-1">
<noscript><p>This page needs JavaScript. The same data is in the JSON API, starting at <a href="/api/runs">/api/runs</a>.</p></noscript>
</main>
</body>
</html>
`;
}
