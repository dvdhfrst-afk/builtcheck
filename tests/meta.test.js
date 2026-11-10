// Page metadata rules: titles, descriptions, canonical links, top headings, viewport, encoding,
// icons and share cards. Each rule is shown both reporting and staying quiet.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { REPO_ROOT, findingsFor, withFixtureSite, withSite } from "./helpers.js";

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

// A whole page with a reasonable head, so a case only changes what it is about.
function doc({ title = "Example Bakery home page", head = "", body = "<h1>Example Bakery</h1>", lang = "en", charset = '<meta charset="utf-8">' } = {}) {
  return `<!doctype html>\n<html lang="${lang}">\n<head>${charset}\n<title>${title}</title>\n${head}\n</head>\n<body>${body}</body>\n</html>\n`;
}

function found(files, rule, config) {
  return findingsFor(files, rule, config).map((finding) => `${finding.rule} ${finding.file}:${finding.line ?? "-"} ${finding.message}`);
}

function count(files, rule, config) {
  return findingsFor(files, rule, config).filter((finding) => finding.rule === rule).length;
}

// ---- meta/title-missing

test("title-missing reports a page with no title, an empty one, or only an SVG title", () => {
  const results = found({
    "none.html": "<!doctype html><html><head></head><body><h1>Hi</h1></body></html>",
    "empty.html": doc({ title: "   " }),
    "svg.html": '<!doctype html><html><head></head><body><svg><title>Logo</title></svg></body></html>',
  }, "meta/title-missing");
  assert.equal(results.length, 3);
  assert.match(results.find((line) => line.includes("none.html")), /none\.html:1 Page has no <title>, so browsers and search results show its address instead/);
  assert.match(results.find((line) => line.includes("empty.html")), /Page title is empty/);
  assert.ok(results.some((line) => line.includes("svg.html")));
});

test("title-missing leaves fragments, verification files, redirects and error pages alone", () => {
  assert.deepEqual(found({
    "index.html": doc(),
    "partials/card.html": '<div class="card">Card</div>',
    "google1234abcd.html": "google-site-verification: google1234abcd.html",
    "old.html": '<!doctype html><html><head><meta http-equiv="refresh" content="0; url=/"></head></html>',
    "404.html": "<!doctype html><html><head></head><body>Not here</body></html>",
  }, "meta/title-missing"), []);
});

test("title-missing ignores a title inside a template", () => {
  assert.equal(count({ "a.html": "<!doctype html><html><head></head><body><template><title>Later</title></template></body></html>" }, "meta/title-missing"), 1);
});

// ---- meta/title-length

test("title-length reports long and short titles on indexable pages, counting characters", () => {
  const long = "Example Bakery sourdough loaves, rye breads and pastries baked daily";
  const results = found({
    "long.html": doc({ title: long }),
    "short.html": doc({ title: "Home" }),
    "accents.html": doc({ title: "é".repeat(40) }),
    "hidden.html": doc({ title: "Home", head: '<meta name="robots" content="noindex">' }),
  }, "meta/title-length");
  assert.equal(results.length, 2);
  assert.match(results[0], /long\.html:4 Title is 68 characters, over 60, so search results cut it short: "Example Bakery/);
  assert.match(results[1], /short\.html:4 Title "Home" is 4 characters, under 10/);
});

test("title-length limits can be changed", () => {
  const files = { "a.html": doc({ title: "Example Bakery breads" }) };
  assert.equal(count(files, "meta/title-length"), 0);
  assert.equal(count(files, "meta/title-length", { rules: { "meta/title-length": { maxLength: 15 } } }), 1);
  assert.equal(count(files, "meta/title-length", { rules: { "meta/title-length": { minLength: 30 } } }), 1);
});

// ---- meta/title-duplicate and meta/description-duplicate

test("title-duplicate reports one finding per group, on the first page, naming the others", () => {
  const results = found({
    "a.html": doc({ title: "Example Bakery" }),
    "b.html": doc({ title: "example   bakery" }),
    "c/index.html": doc({ title: "Example Bakery" }),
    "d.html": doc({ title: "Rye bread at Example Bakery" }),
    "e.html": doc({ title: "Rye bread at Example Bakery" }),
    "unique.html": doc({ title: "Opening hours of Example Bakery" }),
  }, "meta/title-duplicate");
  assert.deepEqual(results, [
    'meta/title-duplicate a.html:4 Title "Example Bakery" is also used by b.html and c/index.html, so search engines cannot tell these pages apart',
    'meta/title-duplicate d.html:4 Title "Rye bread at Example Bakery" is also used by e.html, so search engines cannot tell the two pages apart',
  ]);
});

test("title-duplicate skips pages that are not indexable and files the exclude option names", () => {
  const files = {
    "a.html": doc({ title: "Example Bakery blog" }),
    "noindex.html": doc({ title: "Example Bakery blog", head: '<meta name="robots" content="noindex">' }),
    "copy.html": doc({ title: "Example Bakery blog", head: '<link rel="canonical" href="/a.html">' }),
    "blog/page/2/index.html": doc({ title: "Example Bakery blog" }),
  };
  assert.deepEqual(found(files, "meta/title-duplicate"), [
    'meta/title-duplicate a.html:4 Title "Example Bakery blog" is also used by blog/page/2/index.html, so search engines cannot tell the two pages apart',
  ]);
  assert.equal(count(files, "meta/title-duplicate", { rules: { "meta/title-duplicate": { exclude: ["blog/page/**"] } } }), 0);
});

test("title-duplicate names at most four other pages", () => {
  const files = {};
  for (let i = 0; i < 7; i += 1) files[`p${i}.html`] = doc({ title: "Example Bakery page" });
  const [message] = found(files, "meta/title-duplicate");
  assert.match(message, /p1\.html, p2\.html, p3\.html, p4\.html and 2 more/);
});

test("description-duplicate compares meta descriptions the same way", () => {
  const description = '<meta name="description" content="Bread baked every morning at Example Bakery.">';
  const results = found({
    "a.html": doc({ title: "Example Bakery one", head: description }),
    "b.html": doc({ title: "Example Bakery two", head: description }),
    "c.html": doc({ title: "Example Bakery three", head: '<meta name="description" content="Something else entirely.">' }),
  }, "meta/description-duplicate");
  assert.deepEqual(results, [
    'meta/description-duplicate a.html:5 Meta description "Bread baked every morning at Example Bakery." is also used by b.html, so search engines cannot tell the two pages apart',
  ]);
});

// ---- meta/description-missing and meta/description-length

test("description-missing reports a missing or empty description on indexable pages", () => {
  const results = found({
    "none.html": doc(),
    "empty.html": doc({ head: '<meta name="description" content="  ">' }),
    "fine.html": doc({ head: '<meta name="description" content="Fresh bread from Example Bakery.">' }),
    "private.html": doc({ head: '<meta name="robots" content="noindex">' }),
  }, "meta/description-missing");
  assert.equal(results.length, 2);
  assert.match(results[0], /empty\.html:5 Meta description is empty/);
  assert.match(results[1], /none\.html:- Page has no meta description/);
});

test("description-length reports a description over the limit", () => {
  const long = "Fresh bread. ".repeat(14);
  const files = {
    "a.html": doc({ head: `<meta name="description" content="${long}">` }),
    "b.html": doc({ head: '<meta name="description" content="Fresh bread from Example Bakery.">' }),
  };
  const results = found(files, "meta/description-length");
  assert.equal(results.length, 1);
  assert.match(results[0], /a\.html:5 Meta description is 181 characters, over 160/);
  assert.equal(count(files, "meta/description-length", { rules: { "meta/description-length": { maxLength: 200 } } }), 0);
});

// ---- canonical links

test("canonical-multiple reports canonical links that disagree, not ones that repeat a URL", () => {
  const config = { site: { url: "https://www.example.com" } };
  assert.deepEqual(found({
    "a.html": doc({ head: '<link rel="canonical" href="https://www.example.com/a.html">\n<link rel="canonical" href="https://www.example.com/b.html">' }),
    "b.html": doc({ head: '<link rel="canonical" href="https://www.example.com/b.html">\n<link rel="canonical" href="/b.html">' }),
  }, "meta/canonical-multiple", config), [
    "meta/canonical-multiple a.html:6 Page has 2 canonical links naming different URLs (https://www.example.com/a.html and https://www.example.com/b.html), so search engines may ignore them all",
  ]);
});

test("canonical-invalid reports empty, non-web, fragment, local and misplaced canonical links", () => {
  const results = found({
    "empty.html": doc({ head: '<link rel="canonical" href="">' }),
    "nohref.html": doc({ head: '<link rel="canonical">' }),
    "mail.html": doc({ head: '<link rel="canonical" href="mailto:jane@example.com">' }),
    "hash.html": doc({ head: '<link rel="canonical" href="#top">' }),
    "local.html": doc({ head: '<link rel="canonical" href="http://localhost:4321/local.html">' }),
    "body.html": doc({ body: '<h1>Example</h1><link rel="canonical" href="https://www.example.com/body.html">' }),
    "fine.html": doc({ head: '<link rel="canonical" href="https://www.example.com/fine.html">' }),
  }, "meta/canonical-invalid");
  assert.equal(results.length, 6);
  assert.ok(results.some((line) => /empty\.html:5 Canonical link has an empty href/.test(line)));
  assert.ok(results.some((line) => /nohref\.html:5 Canonical link has no href/.test(line)));
  assert.ok(results.some((line) => /mail\.html:5 Canonical URL mailto:jane@example\.com is not a web address/.test(line)));
  assert.ok(results.some((line) => /hash\.html:5 Canonical URL #top is only a fragment/.test(line)));
  assert.ok(results.some((line) => /local\.html:5 Canonical URL http:\/\/localhost:4321\/local\.html points at a local address/.test(line)));
  assert.ok(results.some((line) => /body\.html:7 Canonical link is in the body/.test(line)));
});

test("canonical-invalid leaves a malformed URL to links/broken-internal when that rule is on", () => {
  const files = { "a.html": doc({ head: '<link rel="canonical" href="http://[broken/">' }) };
  assert.equal(count(files, "meta/canonical-invalid"), 1);
  const both = findingsFor(files, "meta/canonical-invalid", { rules: { "links/broken-internal": "error" } });
  assert.deepEqual(both.map((finding) => finding.rule), ["links/broken-internal"]);
});

test("canonical-relative reports relative and scheme-relative canonical URLs", () => {
  const results = found({
    "a.html": doc({ head: '<link rel="canonical" href="/a.html">' }),
    "b.html": doc({ head: '<link rel="canonical" href="//www.example.com/b.html">' }),
    "c.html": doc({ head: '<link rel="canonical" href="https://www.example.com/c.html">' }),
    "d.html": doc({ head: '<link rel="canonical" href="HTTPS://www.example.com/d.html">' }),
  }, "meta/canonical-relative");
  assert.equal(results.length, 2);
  assert.match(results[0], /a\.html:5 Canonical URL \/a\.html is relative/);
  assert.match(results[1], /b\.html:5 Canonical URL \/\/www\.example\.com\/b\.html is relative/);
});

test("canonical-target reports canonicals naming pages that cannot be canonical", () => {
  const config = { site: { url: "https://www.example.com" } };
  const canonical = (path) => doc({ head: `<link rel="canonical" href="https://www.example.com${path}">` });
  const results = found({
    "missing.html": canonical("/gone/"),
    "redirected.html": canonical("/moved/"),
    "to-noindex.html": canonical("/private.html"),
    "to-refresh.html": canonical("/refresh.html"),
    "to-error.html": canonical("/404.html"),
    "chain.html": canonical("/middle.html"),
    "self.html": canonical("/self.html"),
    "to-file.html": canonical("/menu.pdf"),
    "private.html": doc({ head: '<meta name="robots" content="noindex, follow">' }),
    "refresh.html": '<!doctype html><html><head><meta http-equiv="refresh" content="0; url=/self.html"></head></html>',
    "404.html": doc({ title: "Not found" }),
    "middle.html": canonical("/final.html"),
    "final.html": canonical("/final.html"),
    "menu.pdf": "%PDF-1.4",
    "_redirects": "/moved/ /self.html 301\n",
  }, "meta/canonical-target", config);
  assert.deepEqual(results.map((line) => line.split(" ")[1]), [
    "chain.html:5", "missing.html:5", "redirected.html:5", "to-error.html:5", "to-noindex.html:5", "to-refresh.html:5",
  ]);
  assert.match(results[0], /names middle\.html, which names final\.html as its own canonical/);
  assert.match(results[1], /Canonical URL https:\/\/www\.example\.com\/gone\/ is not in the build/);
  assert.match(results[2], /redirects \(to \/self\.html\)/);
  assert.match(results[3], /names 404\.html, which is an error page/);
  assert.match(results[4], /names private\.html, which asks not to be indexed/);
  assert.match(results[5], /names refresh\.html, which only redirects/);
});

test("canonical-target leaves a missing page to links/broken-internal when that rule is on", () => {
  const files = { "a.html": doc({ head: '<link rel="canonical" href="/gone/">' }) };
  const both = findingsFor(files, "meta/canonical-target", { rules: { "links/broken-internal": "error" } });
  assert.deepEqual(both.map((finding) => finding.rule), ["links/broken-internal"]);
});

test("canonical-host reports another host or the other scheme, only when the site host is known", () => {
  const files = {
    "other.html": doc({ head: '<link rel="canonical" href="https://blog.example.org/other/">' }),
    "bare.html": doc({ head: '<link rel="canonical" href="https://example.com/bare.html">' }),
    "plain.html": doc({ head: '<link rel="canonical" href="http://www.example.com/plain.html">' }),
    "local.html": doc({ head: '<link rel="canonical" href="http://127.0.0.1:8080/local.html">' }),
  };
  const results = found(files, "meta/canonical-host", { site: { url: "https://www.example.com" } });
  assert.equal(results.length, 2);
  assert.match(results[0], /other\.html:5 Canonical URL https:\/\/blog\.example\.org\/other\/ is on blog\.example\.org, not the site host example\.com/);
  assert.match(results[1], /plain\.html:5 Canonical URL http:\/\/www\.example\.com\/plain\.html uses http, but the site URL uses https/);
  // With no site URL, sitemap or matching canonical, nothing says which host is this site's.
  assert.equal(count({ "other.html": files["other.html"] }, "meta/canonical-host"), 0);
});

// ---- meta/h1-missing and meta/h1-multiple

test("h1-missing reports indexable pages with no visible h1", () => {
  const results = found({
    "none.html": doc({ body: "<h2>Menu</h2>" }),
    "hidden.html": doc({ body: "<h1 hidden>Menu</h1>" }),
    "styled.html": doc({ head: "<style>.gone { display: none }</style>", body: '<h1 class="gone">Menu</h1>' }),
    "template.html": doc({ body: "<template><h1>Menu</h1></template>" }),
    "empty.html": doc({ body: "<h1> </h1>" }),
    "private.html": doc({ head: '<meta name="robots" content="noindex">', body: "<p>Thanks</p>" }),
  }, "meta/h1-missing");
  assert.deepEqual(results.map((line) => line.split(" ")[1]), ["empty.html:7", "hidden.html:7", "none.html:-", "styled.html:7", "template.html:-"]);
  assert.match(results[2], /Page has no h1 heading/);
  assert.match(results[1], /only h1 heading is hidden or empty/);
});

test("h1-missing accepts a logo heading, a heading for screen readers and an aria-label", () => {
  assert.deepEqual(found({
    "logo.html": doc({ body: '<h1><a href="/"><img src="/logo.png" alt="Example Bakery"></a></h1>' }),
    "reader.html": doc({ body: '<h1 class="sr-only">Example Bakery</h1>' }),
    "label.html": doc({ body: '<h1 aria-label="Example Bakery"><svg></svg></h1>' }),
    "logo.png": "x",
  }, "meta/h1-missing"), []);
});

test("h1-multiple reports a second visible h1, but not a copy for another screen width", () => {
  const results = found({
    "two.html": doc({ body: "<h1>Example Bakery</h1><p>Bread</p><h1>Our loaves</h1>" }),
    "three.html": doc({ body: "<h1>One</h1><h1>Two</h1><h1>Three</h1>" }),
    "responsive.html": doc({ body: '<h1 class="md:hidden">Example Bakery</h1><h1 class="hidden md:block">Example Bakery, fresh daily</h1>' }),
    "media.html": doc({ head: "<style>@media (min-width: 768px) { .small { display: none } }</style>", body: '<h1 class="small">A</h1><h1>B</h1>' }),
    "template.html": doc({ body: "<h1>Real</h1><template><h1>Later</h1></template>" }),
  }, "meta/h1-multiple");
  assert.deepEqual(results, [
    'meta/h1-multiple three.html:7 Page has 3 visible h1 headings ("One" and "Two" and more). Keep one and make the rest h2',
    'meta/h1-multiple two.html:7 Page has 2 visible h1 headings ("Example Bakery" and "Our loaves"). Keep one and make the rest h2',
  ]);
});

// ---- meta/viewport-missing and meta/viewport-zoom

test("viewport-missing reports a document page with no viewport, not error pages or redirects", () => {
  const results = found({
    "a.html": doc(),
    "b.html": doc({ head: VIEWPORT }),
    "404.html": doc(),
    "old.html": '<!doctype html><html><head><title>Moved</title><meta http-equiv="refresh" content="0; url=/b.html"></head></html>',
    "private.html": doc({ head: '<meta name="robots" content="noindex">' }),
  }, "meta/viewport-missing");
  assert.deepEqual(results.map((line) => line.split(" ")[1]), ["a.html:-", "private.html:-"]);
});

test("viewport-zoom reports settings that stop zooming", () => {
  const viewport = (content) => doc({ head: `<meta name="viewport" content="${content}">` });
  const results = found({
    "no.html": viewport("width=device-width, user-scalable=no"),
    "zero.html": viewport("width=device-width; user-scalable=0"),
    "max.html": viewport("width=device-width, initial-scale=1, maximum-scale=1.0"),
    "both.html": viewport("width=device-width, maximum-scale=1, user-scalable=no"),
    "ok.html": viewport("width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes"),
    "plain.html": viewport("width=device-width, initial-scale=1"),
  }, "meta/viewport-zoom");
  assert.deepEqual(results.map((line) => line.split(" ")[1]), ["both.html:5", "both.html:5", "max.html:5", "no.html:5", "zero.html:5"]);
  assert.match(results[2], /maximum-scale=1\.0, which stops people from zooming in to 2x/);
  assert.match(results[3], /user-scalable=no/);
});

test("viewport-zoom takes the lowest acceptable maximum-scale as an option", () => {
  const files = { "a.html": doc({ head: '<meta name="viewport" content="width=device-width, maximum-scale=3">' }) };
  assert.equal(count(files, "meta/viewport-zoom"), 0);
  assert.equal(count(files, "meta/viewport-zoom", { rules: { "meta/viewport-zoom": { minMaximumScale: 5 } } }), 1);
});

// ---- meta/charset

test("charset reports a missing, late or legacy encoding declaration", () => {
  const padding = `<!-- ${"x".repeat(1100)} -->`;
  const results = found({
    "none.html": doc({ charset: "" }),
    "late.html": `<!doctype html><html lang="en"><head>${padding}<meta charset="utf-8"><title>Late page title</title></head><body><h1>x</h1></body></html>`,
    "legacy.html": doc({ charset: '<meta charset="windows-1252">' }),
    "equiv.html": doc({ charset: '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">' }),
    "fine.html": doc(),
  }, "meta/charset");
  assert.equal(results.length, 3);
  assert.match(results[0], /late\.html:1 Character encoding is declared \d+ bytes in, after the first 1024 bytes/);
  assert.match(results[1], /legacy\.html:3 Page declares the windows-1252 character encoding\. HTML requires UTF-8/);
  assert.match(results[2], /none\.html:- Page declares no character encoding/);
});

test("charset counts bytes, not characters, and accepts a byte order mark", () => {
  const accented = `<!doctype html><html lang="fr"><head><meta name="description" content="${"é".repeat(500)}"><meta charset="utf-8"><title>Pain</title></head><body></body></html>`;
  assert.equal(count({ "a.html": accented }, "meta/charset"), 1);
  const marked = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(doc({ charset: "" }))]);
  assert.equal(count({ "b.html": marked }, "meta/charset"), 0);
});

// ---- meta/favicon-missing and meta/icon-broken

test("favicon-missing reports a site with no favicon.ico and no working icon link", () => {
  assert.deepEqual(found({ "index.html": doc() }, "meta/favicon-missing"), [
    "meta/favicon-missing favicon.ico:- The site has no favicon: no favicon.ico at the root of the build, and no page links an icon that exists, so browser tabs and bookmarks show a blank icon",
  ]);
  assert.equal(count({ "index.html": doc({ head: '<link rel="icon" href="/missing.png">' }) }, "meta/favicon-missing"), 1);
});

test("favicon-missing is quiet with a root favicon.ico, a working icon link, a data or remote icon, or no documents", () => {
  for (const files of [
    { "index.html": doc(), "favicon.ico": "icon" },
    { "index.html": doc(), "about.html": doc({ head: '<link rel="shortcut icon" href="img/icon.png">' }), "img/icon.png": "png" },
    { "index.html": doc({ head: '<link rel="icon" href="data:image/svg+xml,<svg></svg>">' }) },
    { "index.html": doc({ head: '<link rel="icon" href="https://cdn.example.org/icon.png">' }) },
    { "fragment.html": "<div>Card</div>" },
  ]) {
    assert.equal(count(files, "meta/favicon-missing"), 0, Object.keys(files).join(" "));
  }
});

test("icon-broken reports missing, empty and wrong icon files", () => {
  const results = found({
    "index.html": doc({
      head: [
        '<link rel="icon" href="/missing.ico">',
        '<link rel="icon" href="/about.html">',
        '<link rel="apple-touch-icon" href="/touch.svg">',
        '<link rel="icon" href="/empty.png">',
        '<link rel="icon" type="image/png" href="/good.png">',
        '<link rel="apple-touch-icon" href="/touch.png">',
        '<link rel="mask-icon" href="/mask.svg" color="#335">',
      ].join("\n"),
    }),
    "about.html": doc(),
    "touch.svg": "<svg/>",
    "empty.png": "",
    "good.png": "png",
    "touch.png": "png",
    "mask.svg": "<svg/>",
  }, "meta/icon-broken");
  assert.deepEqual(results, [
    "meta/icon-broken index.html:5 Icon /missing.ico is not in the build",
    "meta/icon-broken index.html:6 Icon /about.html leads to about.html, which is not an image",
    "meta/icon-broken index.html:7 Icon /touch.svg is a touch icon in a format iPhones and iPads do not use. Give them a PNG, 180 by 180",
    "meta/icon-broken index.html:8 Icon /empty.png is an empty file",
  ]);
});

test("icon-broken leaves a missing file to links/broken-asset when that rule is on", () => {
  const both = findingsFor({ "index.html": doc({ head: '<link rel="icon" href="/missing.ico">' }) }, "meta/icon-broken", { rules: { "links/broken-asset": "error" } });
  assert.deepEqual(both.map((finding) => finding.rule), ["links/broken-asset"]);
});

// ---- social cards

test("og-missing lists the Open Graph properties an indexable page lacks", () => {
  const results = found({
    "none.html": doc(),
    "half.html": doc({ head: '<meta property="og:title" content="Example Bakery">' }),
    "empty.html": doc({ head: '<meta property="og:title" content=""><meta property="og:description" content="Bread">' }),
    "full.html": doc({ head: '<meta property="og:title" content="Example Bakery"><meta property="og:description" content="Bread">' }),
    "private.html": doc({ head: '<meta name="robots" content="noindex">' }),
  }, "meta/og-missing");
  assert.deepEqual(results, [
    "meta/og-missing empty.html:- Page has no og:title, so a share of it shows whatever the social site guesses",
    "meta/og-missing half.html:- Page has no og:description, so a share of it shows whatever the social site guesses",
    "meta/og-missing none.html:- Page has no og:title or og:description, so a share of it shows whatever the social site guesses",
  ]);
});

test("og-missing takes the list of properties as an option", () => {
  const files = { "a.html": doc({ head: '<meta property="og:title" content="Example Bakery"><meta property="og:description" content="Bread">' }) };
  const [message] = found(files, "meta/og-missing", { rules: { "meta/og-missing": { properties: ["og:title", "og:type", "og:url"] } } });
  assert.match(message, /Page has no og:type or og:url/);
});

test("og-url reports a relative og:url or one that differs from the canonical", () => {
  const results = found({
    "relative.html": doc({ head: '<meta property="og:url" content="/relative.html">' }),
    "differs.html": doc({ head: '<link rel="canonical" href="https://www.example.com/differs/">\n<meta property="og:url" content="https://www.example.com/differs">' }),
    "same.html": doc({ head: '<link rel="canonical" href="https://www.example.com/same/">\n<meta property="og:url" content="https://WWW.example.com/same/">' }),
    "alone.html": doc({ head: '<meta property="og:url" content="https://www.example.com/alone.html">' }),
  }, "meta/og-url");
  assert.deepEqual(results, [
    "meta/og-url differs.html:6 og:url https://www.example.com/differs differs from the canonical URL https://www.example.com/differs/, so shares and search count this page under two addresses",
    "meta/og-url relative.html:5 og:url /relative.html is not an absolute URL, which Open Graph requires",
  ]);
});

test("twitter-card reports unknown and empty card types", () => {
  const card = (value) => doc({ head: `<meta name="twitter:card" content="${value}">` });
  const files = { "large.html": card("large"), "empty.html": card(""), "fine.html": card("summary_large_image"), "upper.html": card("Summary") };
  const results = found(files, "meta/twitter-card");
  assert.deepEqual(results, [
    "meta/twitter-card empty.html:5 twitter:card is empty",
    'meta/twitter-card large.html:5 twitter:card "large" is not a card type (summary, summary_large_image, app, player), so no card is shown',
  ]);
  assert.equal(count(files, "meta/twitter-card", { rules: { "meta/twitter-card": { values: ["summary", "large"] } } }), 2);
});

// ---- tricky markup

test("upper case and unquoted head markup is read like any other", () => {
  const files = {
    "a.html": '<!DOCTYPE html><HTML LANG=en><HEAD><META CHARSET=UTF-8><META NAME=Viewport CONTENT="width=device-width, maximum-scale=1"><TITLE>Example Bakery home</TITLE><META NAME=DESCRIPTION CONTENT=Bread><LINK REL="Canonical" HREF=/a.html><LINK REL="SHORTCUT ICON" HREF=/favicon.png></HEAD><BODY><H1>x</H1></BODY></HTML>',
    "favicon.png": "png",
  };
  const rules = findingsFor(files, "meta/*").map((finding) => finding.rule).sort();
  assert.deepEqual(rules, ["meta/canonical-relative", "meta/og-missing", "meta/viewport-zoom"]);
});

test("titles compare after character references are decoded", () => {
  const results = found({
    "a.html": doc({ title: "Bread &amp; butter at Example Bakery" }),
    "b.html": doc({ title: "Bread & butter at Example Bakery" }),
  }, "meta/title-duplicate");
  assert.equal(results.length, 1);
  assert.match(results[0], /Title "Bread & butter at Example Bakery" is also used by b\.html/);
});

// ---- whole sites

const CLEAN_PAGE = (title, path, extra = "") => doc({
  title,
  head: [
    VIEWPORT,
    `<meta name="description" content="${title}, from the invented Example Bakery.">`,
    `<link rel="canonical" href="https://www.example.com${path}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${title}, from the invented Example Bakery.">`,
    `<meta property="og:url" content="https://www.example.com${path}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    extra,
  ].join("\n"),
  body: `<header><a href="/"><img src="/favicon.svg" alt=""></a></header><main><h1>${title}</h1></main>`,
});

test("a well built site gets no metadata findings", () => {
  const files = {
    "index.html": CLEAN_PAGE("Example Bakery, bread daily", "/"),
    "about/index.html": CLEAN_PAGE("About Example Bakery", "/about/"),
    "menu/index.html": CLEAN_PAGE("The Example Bakery menu", "/menu/"),
    "404.html": "<!doctype html><html lang=\"en\"><head><title>Not found</title></head><body><p>Nothing here</p></body></html>",
    "thanks/index.html": doc({ title: "Thanks for your order", head: `${VIEWPORT}<meta name="robots" content="noindex">`, body: "<p>Thanks</p>" }),
    "old/index.html": '<!doctype html><html><head><meta http-equiv="refresh" content="0; url=/about/"></head></html>',
    "favicon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>",
    "apple-touch-icon.png": "png",
  };
  assert.deepEqual(found(files, "meta/*", { site: { url: "https://www.example.com" } }), []);
});

test("the clean fixture site and the after example get no metadata or language findings", () => {
  const groups = (finding) => finding.rule.startsWith("meta/") || finding.rule.startsWith("i18n/");
  const fixture = withFixtureSite("clean-site", (root) => audit(root).findings.filter(groups));
  assert.deepEqual(fixture, []);
  const after = audit(join(REPO_ROOT, "examples", "after")).findings.filter(groups);
  assert.deepEqual(after, []);
});

test("the command line reports metadata findings and filters to them with --only", () => {
  withSite({ "index.html": doc({ title: "Home", head: '<meta name="viewport" content="width=device-width, user-scalable=no">' }) }, (root) => {
    const run = spawnSync(process.execPath, [join(REPO_ROOT, "bin", "builtcheck.js"), root, "--no-config", "--only", "meta/*", "--format", "json"], { encoding: "utf8" });
    assert.equal(run.status, 1, run.stderr);
    const rules = new Set(JSON.parse(run.stdout).findings.map((finding) => finding.rule));
    assert.deepEqual([...rules].sort(), ["meta/description-missing", "meta/favicon-missing", "meta/og-missing", "meta/title-length", "meta/viewport-zoom"]);
  });
});

test("an ignore comment silences a metadata finding on its page", () => {
  const files = { "a.html": doc({ title: "Home", head: "<!-- builtcheck-ignore-file meta/title-length -->" }) };
  withSite(files, (root) => {
    const result = audit(root, { rules: { "*": "off", "meta/title-length": "warning" } });
    assert.equal(result.findings.length, 0);
    assert.equal(result.summary.suppressed, 1);
  });
});
