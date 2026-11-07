// Cases found by using the tool on real builds and on deliberately messy ones. Each protects a
// false alarm that would fail a correct build, or a problem the documentation says is caught.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { findPureColors } from "../src/css/colors.js";
import { normalizeFamily } from "../src/css/fonts.js";
import { readConfigFile, resolveConfig } from "../src/engine/config.js";
import { allRules } from "../src/rules/index.js";
import { expandFileGlob, makeMatcher } from "../src/site/glob.js";
import { matchRedirect, parseRedirects } from "../src/site/redirects.js";
import { findingsFor, FIXTURES, page, REPO_ROOT, withSite } from "./helpers.js";

const overflow = (body, files = {}) => findingsFor({ "index.html": page(body), ...files }, "style/phone-overflow");

const DOCS_SITEMAP = "<urlset><url><loc>https://www.example.com/docs/</loc></url><url><loc>https://www.example.com/docs/about/</loc></url></urlset>";

function docsSite(body, extra = {}) {
  return {
    "sitemap.xml": DOCS_SITEMAP,
    "index.html": page(body),
    "about/index.html": page('<h2 id="team">Team</h2>'),
    ...extra,
  };
}

function linkFindings(files, config = {}) {
  return withSite(files, (root) => audit(root, { ...config, rules: { "*": "off", "links/*": "error" } }));
}

// ---- Phone overflow

test("a width is capped by any max-width that fits a phone", () => {
  for (const classes of ["w-[500px] max-w-[90vw]", "w-[500px] max-w-[95%]", "w-[480px] max-w-sm", "w-[800px] max-w-[300px]", "w-[800px] max-w-full", "w-[800px] max-w-80"]) {
    assert.deepEqual(overflow(`<div class="${classes}">x</div>`), [], classes);
  }
});

test("a max-width wider than the phone does not cap anything", () => {
  for (const classes of ["w-[500px] max-w-screen-sm", "w-[500px] max-w-md", "w-[900px] max-w-[800px]"]) {
    assert.equal(overflow(`<div class="${classes}">x</div>`).length, 1, classes);
  }
});

test("scrolling wrappers count whether they come from a class, an inline style or a stylesheet", () => {
  const inner = '<div class="min-w-[800px]">x</div>';
  assert.deepEqual(overflow(`<div style="overflow-x:auto">${inner}</div>`), []);
  assert.deepEqual(overflow(`<div style="overflow:hidden">${inner}</div>`), []);
  assert.deepEqual(overflow(`<style>.s{overflow-x:auto}</style><div class="s">${inner}</div>`), []);
  assert.deepEqual(overflow(`<link rel="stylesheet" href="/a.css"><div class="s">${inner}</div>`, { "a.css": ".s{overflow-x:scroll}" }), []);
  assert.equal(overflow(`<div style="overflow-x:visible">${inner}</div>`).length, 1);
});

test("hidden elements cannot overflow", () => {
  const grid = 'class="grid grid-cols-12 gap-10"';
  assert.deepEqual(overflow(`<div hidden ${grid}>x</div>`), []);
  assert.deepEqual(overflow(`<div style="display:none" ${grid}>x</div>`), []);
  assert.deepEqual(overflow(`<div style="display:none"><div ${grid}>x</div></div>`), []);
  assert.deepEqual(overflow(`<template><div ${grid}>x</div></template>`), []);
  assert.deepEqual(overflow(`<style>.m{display:none}</style><div class="m"><div ${grid}>x</div></div>`), []);
  assert.deepEqual(overflow(`<style>@media (max-width:600px){.m{display:none}}</style><div class="m"><div ${grid}>x</div></div>`), []);
});

test("position from a stylesheet exempts a fixed width", () => {
  assert.deepEqual(overflow('<style>.d{position:absolute}</style><div class="d w-[800px]">x</div>'), []);
});

test("a max-width media query can collapse a grid in several ways", () => {
  const grid = ".a{display:grid;grid-template-columns:repeat(12,1fr);gap:40px}";
  const check = (css) => findingsFor({ "a.css": grid + css, "index.html": page('<div class="a">x</div>') }, "style/phone-overflow");
  assert.deepEqual(check("@media (max-width:600px){.a{display:block}}"), []);
  assert.deepEqual(check("@media (max-width:600px){.a{gap:1px}}"), []);
  assert.deepEqual(check("@media (max-width:600px){.a,.b{grid-template-columns:1fr}}"), []);
  assert.equal(check("@media (max-width:600px){.a{display:grid}}").length, 1);
  assert.equal(check("@media (max-width:600px){.a{gap:39px}}").length, 1);
  // A query for a width below the phone does not help the phone.
  assert.equal(check("@media (max-width:320px){.a{display:block}}").length, 1);
});

test("max-md: classes reach a phone", () => {
  assert.equal(overflow('<div class="grid grid-cols-12 max-md:gap-10">x</div>').length, 1);
  assert.equal(overflow('<div class="grid max-md:grid-cols-12 gap-10">x</div>').length, 1);
  assert.equal(overflow('<div class="grid max-md:grid-cols-12 max-md:gap-10">x</div>').length, 1);
  assert.deepEqual(overflow('<div class="grid grid-cols-12 gap-10 max-md:grid-cols-none">x</div>'), []);
  assert.deepEqual(overflow('<div class="grid grid-cols-12 gap-10 max-md:gap-1">x</div>'), []);
  assert.deepEqual(overflow('<div class="w-[800px] max-md:w-full">x</div>'), []);
  assert.deepEqual(overflow('<div class="grid-cols-12 gap-10 max-md:hidden">x</div>'), []);
});

test("fixed widths are caught in stylesheets, style blocks and inline styles", () => {
  const used = '<div class="a">x</div>';
  for (const css of [".a{width:1200px}", ".a{min-width:1200px}", ".a{width:75rem}"]) {
    assert.equal(overflow(used, { "a.css": css }).length, 1, css);
  }
  assert.equal(overflow(`<style>.a{width:1200px}</style>${used}`).length, 1);
  assert.equal(overflow('<div style="width:1200px">x</div>').length, 1);
  assert.equal(overflow("<table><tr><td>x</td></tr></table>", { "a.css": "table{width:1200px}" }).length, 1);
});

test("fixed widths that do not reach a phone are left alone", () => {
  const used = '<div class="a">x</div>';
  const clean = {
    "fits": ".a{width:300px}",
    "relative": ".a{width:120%}",
    "capped in the rule": ".a{width:1200px;max-width:100%}",
    "capped by another rule": ".a{width:1200px}div{max-width:100%}",
    "only above phone width": "@media (min-width:768px){.a{width:1200px}}",
    "replaced on phones": ".a{width:1200px}@media (max-width:767px){.a{width:100%}}",
    "out of flow": ".a{width:1200px;position:absolute}",
    "nothing uses it": ".nope{width:1200px}",
    "a pseudo-element": ".a::before{width:1200px}",
    "print": "@media print{.a{width:1200px}}",
    "keyframes": "@keyframes k{from{width:1200px}}",
    "overridden later": ".a{width:1200px}.a{width:100%}",
  };
  for (const [name, css] of Object.entries(clean)) {
    const body = `<link rel="stylesheet" href="/a.css">${used}`;
    assert.deepEqual(overflow(body, { "a.css": css }), [], name);
  }
  assert.deepEqual(overflow('<div style="overflow:auto"><div style="width:1200px">x</div></div>'), []);
});

test("the rule for a width class is not reported twice from compiled CSS", () => {
  const css = ".w-\\[800px\\]{width:800px}";
  const found = overflow('<link rel="stylesheet" href="/a.css"><div class="w-[800px]">x</div>', { "a.css": css });
  assert.deepEqual(found.map((f) => f.file), ["index.html"]);
});

// ---- Rules that skip CSS nothing uses

test("unused CSS is not reported unless asked, and a selector this tool cannot judge still is", () => {
  const files = { "index.html": page('<a href="/">x</a>'), "a.css": ".nope{color:#000}.nope:hover{color:#fff}a:hover{color:#000}a:unknown-state{color:#000}a >{color:#000}" };
  const found = findingsFor(files, "style/pure-color");
  assert.deepEqual(found.map((f) => f.message.split(" of ").pop()).sort(), ["a >", "a:hover", "a:unknown-state"]);
  assert.equal(findingsFor(files, "style/pure-color", { rules: { "style/pure-color": { ignoreUnused: false } } }).length, 5);
});

test("a font in unused CSS is not reported, while one in @font-face still is", () => {
  const files = { "index.html": page("<p>x</p>"), "a.css": '.nope{font-family:Inter}p{font-family:Roboto}@font-face{font-family:Helvetica;src:url(x.woff2)}', "x.woff2": "x" };
  const found = findingsFor(files, "style/banned-font");
  assert.deepEqual(found.map((f) => f.message).sort(), ["Banned font Helvetica in font-family", "Banned font Roboto in font-family of p"]);
});

test("an unused grid from a framework is not an overflow", () => {
  const css = ".row-12{display:grid;grid-template-columns:repeat(12,1fr);gap:40px}";
  assert.deepEqual(overflow("<p>x</p>", { "a.css": css }), []);
  assert.equal(findingsFor({ "index.html": page("<p>x</p>"), "a.css": css }, "style/phone-overflow", { rules: { "style/phone-overflow": { ignoreUnused: false } } }).length, 1);
});

// ---- Copy and stylesheets

test("text a stylesheet always hides is not copy, and text it may show is", () => {
  const check = (css, classes = "t") => findingsFor({ "index.html": page(`<style>${css}</style><div class="${classes}">{{name}}</div>`) }, "copy/placeholder-text");
  assert.deepEqual(check(".t{display:none}"), []);
  assert.deepEqual(check(".t{visibility:hidden}"), []);
  assert.equal(check(".t{display:none}.t.open{display:block}").length, 1);
  assert.equal(check(".t{display:none}@media (min-width:600px){.t{display:block}}").length, 1);
  assert.equal(check(".other{display:none}").length, 1);
});

test("a heading a stylesheet shows at only some widths is not a duplicate", () => {
  const body = (css) => page(`<style>${css}</style><h2 class="m">Plans</h2><h2>Plans</h2>`);
  assert.deepEqual(findingsFor({ "index.html": body(".m{display:none}@media (max-width:600px){.m{display:block}}") }, "copy/duplicate-heading"), []);
  assert.deepEqual(findingsFor({ "index.html": body("@media (min-width:600px){.m{display:none}}") }, "copy/duplicate-heading"), []);
  assert.equal(findingsFor({ "index.html": body(".m{color:red}") }, "copy/duplicate-heading").length, 1);
});

test("a heading for screen readers is not a duplicate", () => {
  for (const name of ["sr-only", "visually-hidden", "visuallyhidden", "screen-reader-text"]) {
    assert.deepEqual(findingsFor({ "index.html": page(`<h2 class="${name}">A</h2><h2>A</h2>`) }, "copy/duplicate-heading"), [], name);
  }
});

// ---- Links, base paths and redirects

test("_redirects sources match with or without the base path", () => {
  for (const line of ["/docs/old /docs/about/ 301", "/old /docs/about/ 301", "/docs/o* /docs/about/ 301"]) {
    const found = linkFindings(docsSite('<a href="/docs/old">x</a>', { _redirects: `${line}\n` })).findings;
    assert.deepEqual(found, [], line);
  }
});

test("externalPaths match with or without the base path", () => {
  for (const path of ["/docs/api/**", "/api/**"]) {
    const found = linkFindings(docsSite('<a href="/docs/api/x">x</a>'), { site: { externalPaths: [path] } }).findings;
    assert.deepEqual(found, [], path);
  }
});

test("a site URL with no path still lets the base path be inferred", () => {
  const result = linkFindings(docsSite('<a href="/docs/about/">x</a>'), { site: { url: "https://www.example.com" } });
  assert.equal(result.site.basePath, "/docs");
  assert.deepEqual(result.findings, []);
});

test("a site URL with a path is the base path", () => {
  const result = linkFindings(docsSite('<a href="/docs/about/">x</a>'), { site: { url: "https://www.example.com/docs" } });
  assert.equal(result.site.basePath, "/docs");
});

test("the content of a template is not checked as links or assets", () => {
  const body = '<template><a href="{{url}}">x</a><img src="${src}" alt=""><a href="/nope/">y</a><a href="#">Read more</a><a href="#">z</a><img src="" alt=""><use href="#nope"></use></template>';
  assert.deepEqual(linkFindings({ "index.html": page(body) }).findings, []);
});

test("an unrendered template in a real link is still reported", () => {
  assert.equal(linkFindings({ "index.html": page('<a href="{{url}}">x</a>') }).findings.length, 1);
});

test("a fragment link follows the base element", () => {
  const files = docsSite('<a href="#team">x</a><a href="#gone">y</a>');
  files["index.html"] = page('<a href="#team">x</a><a href="#gone">y</a>', '<base href="/docs/about/">');
  const found = linkFindings(files).findings;
  assert.deepEqual(found.map((f) => f.message), ["Link #gone points at an id that is not on about/index.html"]);
});

test("a canonical on another site does not make that site this one", () => {
  const body = '<a href="https://blog.example.org/@me/post">x</a>';
  const head = '<link rel="canonical" href="https://blog.example.org/@me/post">';
  assert.deepEqual(linkFindings({ "index.html": page(body, head) }).findings, []);
});

test("percent-encoded redirect sources match", () => {
  const rules = parseRedirects("/caf%C3%A9 / 301\n/bad%ZZ / 301\n");
  assert.ok(matchRedirect(rules, "/caf\u00e9"));
  assert.ok(matchRedirect(rules, "/bad%ZZ"));
});

test("SVG references, preload image sets and empty sources are checked", () => {
  const bad = [
    '<svg><use href="/nope.svg#x"></use></svg>', '<svg><use xlink:href="/nope.svg#x"></use></svg>', '<svg><use xlink:href="#nope"></use></svg>',
    '<svg><use href="#nope"></use></svg>', '<svg><image href="/nope.png"></image></svg>', '<img src="" alt="x">', '<script src=""></script>',
    '<link rel="preload" as="image" imagesrcset="/nope.png 1x">',
  ];
  for (const body of bad) assert.equal(linkFindings({ "index.html": page(body) }).findings.length, 1, body);
  const good = ['<svg><use href="#a"></use><g id="a"></g></svg>', '<img src="" data-src="/x.png" alt="x">', '<img src="" srcset="data:image/png;base64,AA 1x" alt="">', "<script></script>"];
  for (const body of good) assert.deepEqual(linkFindings({ "index.html": page(body) }).findings, [], body);
});

// ---- Foundation

test("a namespace-prefixed sitemap is read, and an image location is not a page", () => {
  const prefixed = '<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://www.example.com/</sm:loc><image:loc>https://www.example.com/i.png</image:loc></sm:url></sm:urlset>';
  const files = { "sitemap.xml": prefixed, "index.html": page("x") };
  assert.deepEqual(findingsFor(files, "foundation/sitemap-invalid", { rules: { "foundation/sitemap-stale-url": "error", "foundation/sitemap-missing-page": "error" } }), []);
});

test("a default social image in a format that cannot be measured goes unmeasured", () => {
  for (const name of ["og.webp", "og.svg", "og.avif"]) {
    const files = { [name]: "<svg/>", "index.html": page("x", `<meta property="og:image" content="/${name}">`) };
    assert.deepEqual(findingsFor(files, "foundation/social-image-size"), [], name);
  }
});

test("a page that only reloads itself is not a redirect", () => {
  const files = {
    "sitemap.xml": "<urlset><url><loc>https://www.example.com/scores.html</loc></url></urlset>",
    "scores.html": page("x", '<meta http-equiv="refresh" content="300">'),
  };
  assert.deepEqual(findingsFor(files, "foundation/sitemap-noindex-url"), []);
  const moved = { ...files, "scores.html": page("x", '<meta http-equiv="refresh" content="0;url=/">') };
  assert.equal(findingsFor(moved, "foundation/sitemap-noindex-url").length, 1);
});

test("a page naming another canonical is not held to the rules for indexable pages", () => {
  const files = {
    "sitemap.xml": "<urlset><url><loc>https://www.example.com/about/</loc></url></urlset>",
    "about/index.html": page("x", '<meta property="og:image" content="/about/i.png">'),
    "about/i.png": "x",
    "dup.html": page("x", '<link rel="canonical" href="https://www.example.com/about/">'),
  };
  const found = findingsFor(files, "foundation/page-social-image", { rules: { "schema/page-missing": "error" } });
  assert.deepEqual(found.map((f) => `${f.rule} ${f.file}`), ["schema/page-missing about/index.html"]);
});

test("a sitemap index that leads nowhere is invalid", () => {
  const self = "<sitemapindex><sitemap><loc>https://www.example.com/sitemap.xml</loc></sitemap></sitemapindex>";
  assert.equal(findingsFor({ "sitemap.xml": self, "index.html": page("x") }, "foundation/sitemap-invalid").length, 1);
  const pair = {
    "sitemap.xml": "<sitemapindex><sitemap><loc>https://www.example.com/b.xml</loc></sitemap></sitemapindex>",
    "b.xml": "<sitemapindex><sitemap><loc>https://www.example.com/sitemap.xml</loc></sitemap></sitemapindex>",
    "index.html": page("x"),
  };
  assert.equal(findingsFor(pair, "foundation/sitemap-invalid").length, 1);
});

test("the robots check tests the path the site lives at", () => {
  const files = docsSite("x", { "robots.txt": "User-agent: *\nDisallow: /docs/\n" });
  assert.equal(findingsFor(files, "foundation/robots-blocks-crawler").length, 10);
  const allowed = docsSite("x", { "robots.txt": "User-agent: *\nDisallow: /other/\n" });
  assert.deepEqual(findingsFor(allowed, "foundation/robots-blocks-crawler"), []);
});

// ---- Colors and fonts

test("colors compiled with an opacity variable are found", () => {
  for (const value of ["rgb(255 255 255/var(--tw-bg-opacity,1))", "rgb(0 0 0/var(--tw-text-opacity))", "rgba(255,255,255,var(--tw-bg-opacity))", "rgb(255 255 255 / var(--tw-bg-opacity, 1))", "rgb(0 0 0 / var(--my-alpha, 1))"]) {
    assert.equal(findPureColors(value).length, 1, value);
  }
  for (const value of ["rgb(0 0 0/var(--my-alpha))", "rgb(0 0 0 / var(--my-alpha, 0.5))", "rgb(var(--r) 0 0)"]) {
    assert.deepEqual(findPureColors(value), [], value);
  }
});

test("color-mix is not pure black or white", () => {
  assert.deepEqual(findPureColors("color-mix(in srgb,#000 50%,transparent)"), []);
  assert.deepEqual(findPureColors("color-mix(in srgb, rgb(0 0 0), white)"), []);
  assert.equal(findPureColors("color-mix(in srgb,#000,#111) #fff").length, 1);
});

test("variable font names run together are the same family", () => {
  assert.equal(normalizeFamily("InterVariable"), "inter");
  assert.equal(normalizeFamily("'Inter Variable'"), "inter");
  assert.equal(normalizeFamily("Variable"), "variable");
});

// ---- Ignore comments

test("next-element works on a CSS rule, in files and style blocks", () => {
  const css = "/* builtcheck-ignore-next-element style/pure-color */\n.a{\n  color:#000;\n  background:#fff;\n}\n.b{color:#000}";
  const body = '<p class="a b">x</p>';
  assert.deepEqual(findingsFor({ "a.css": css, "index.html": page(body) }, "style/pure-color").map((f) => f.line), [6]);
  const inBlock = findingsFor({ "index.html": `<style>${css}</style>${page(body)}` }, "style/pure-color");
  assert.deepEqual(inBlock.map((f) => f.line), [6]);
});

test("next-element works on a group of lines in a text file", () => {
  const robots = "User-agent: *\nAllow: /\n\n# builtcheck-ignore-next-element foundation/robots-blocks-crawler\nUser-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /\n";
  const found = findingsFor({ "robots.txt": robots, "index.html": page("x") }, "foundation/robots-blocks-crawler");
  assert.deepEqual(found.map((f) => f.line), [9]);
});

test("next-element works on an XML element", () => {
  const sitemap = "<urlset>\n<!-- builtcheck-ignore-next-element -->\n<url>\n<loc>https://www.example.com/a</loc>\n</url>\n<url>\n<loc>https://www.example.com/b</loc>\n</url>\n<url><loc>https://www.example.com/</loc></url>\n</urlset>";
  const found = findingsFor({ "sitemap.xml": sitemap, "index.html": page("x") }, "foundation/sitemap-stale-url");
  assert.deepEqual(found.map((f) => f.line), [7]);
});

test("next-line covers the rest of the line when code follows the comment, as in minified files", () => {
  const minified = "/*! builtcheck-ignore-next-line style/banned-font */.a{font-family:Inter}";
  assert.deepEqual(findingsFor({ "a.css": minified, "index.html": page('<p class="a">x</p>') }, "style/banned-font"), []);
  const html = "<p>a &mdash; b</p><!-- builtcheck-ignore-next-line copy/em-dash --><p>c &mdash; d</p>";
  assert.deepEqual(findingsFor({ "index.html": html }, "copy/em-dash").map((f) => f.column), [6]);
});

// ---- Config

test('"*" applies before named groups, wherever it appears', () => {
  for (const rules of [{ "copy/*": "warning", "*": "off" }, { "*": "off", "copy/*": "warning" }]) {
    const resolved = resolveConfig({ rules }, allRules).rules;
    assert.equal(resolved["copy/em-dash"].severity, "warning");
    assert.equal(resolved["links/broken-internal"].severity, "off");
  }
});

test("a config file written as UTF-16 by a shell redirect is read", () => {
  withSite({ "x.txt": "x" }, (root) => {
    const path = join(root, "config.json");
    writeFileSync(path, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"rules":{}}', "utf16le")]));
    assert.deepEqual(readConfigFile(path), { rules: {} });
    writeFileSync(path, `\ufeff{"ignore":[]}`);
    assert.deepEqual(readConfigFile(path), { ignore: [] });
  });
});

test("every way of writing a folder to skip works", () => {
  for (const glob of ["drafts/**", "./drafts/**", "/drafts/**", "drafts/", "drafts", "drafts\\**"]) {
    const match = makeMatcher(expandFileGlob(glob));
    assert.ok(match("drafts/a.html"), glob);
    assert.ok(match("drafts/b/c.html"), glob);
    assert.ok(!match("other/a.html"), glob);
    assert.ok(!match("draftsman.html"), glob);
  }
  const found = findingsFor({ "drafts/a.html": page("<p>TODO</p>"), "b.html": page("<p>TODO</p>") }, "copy/placeholder-text", { ignore: ["./drafts"] });
  assert.deepEqual(found.map((f) => f.file), ["b.html"]);
});

// ---- Pages in other encodings

test("a page declaring another encoding decodes as a browser would", () => {
  const latin = Buffer.from('<!doctype html><meta charset="iso-8859-1"><a href="caf\u00e9.html">x</a>', "latin1");
  assert.deepEqual(linkFindings({ "index.html": latin, "caf\u00e9.html": page("x") }).findings, []);
  const sixteen = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<a href="/nope">x</a>', "utf16le")]);
  assert.equal(linkFindings({ "index.html": sixteen }).findings.length, 1);
  const unknown = Buffer.from('<meta charset="no-such-encoding"><a href="/nope">x</a>');
  assert.equal(linkFindings({ "index.html": unknown }).findings.length, 1);
});

// ---- Pathological input stays fast

function timed(name, fn) {
  test(`${name} finishes promptly`, () => {
    const started = Date.now();
    fn();
    assert.ok(Date.now() - started < 10000, `took ${Date.now() - started}ms`);
  });
}

timed("a redirect source full of wildcards", () => {
  const rules = parseRedirects(`/${"*a".repeat(30)} /x\n`);
  assert.equal(matchRedirect(rules, `/${"a".repeat(60)}b`), null);
});
timed("thousands of references in one paragraph", () => {
  assert.equal(findingsFor({ "index.html": page(`<p>${"&mdash; ".repeat(50000)}</p>`) }, "copy/em-dash").length > 1000, true);
});
timed("unclosed url() calls", () => {
  findingsFor({ "index.html": page("x"), "a.css": `a{background:${"url(".repeat(100000)}}` }, "links/broken-asset");
});
timed("unclosed sitemap locations", () => {
  findingsFor({ "index.html": page("x"), "sitemap.xml": `<urlset>${"<loc>".repeat(100000)}` }, "foundation/sitemap-invalid");
});
timed("hundreds of thousands of unclosed elements", () => {
  findingsFor({ "index.html": `<div>${"<div>".repeat(200000)}` }, "copy/em-dash");
});
timed("deep nesting with text at every level and hiding rules to apply", () => {
  findingsFor({ "index.html": `<style>.x{display:none}</style>${"<div>a".repeat(20000)}` }, "copy/em-dash");
});

// ---- Command line

test("a reader that stops early does not crash the command", async () => {
  const child = spawn(process.execPath, [join(REPO_ROOT, "bin", "builtcheck.js"), join(FIXTURES, "bad-pages", "site"), "--no-config", "--all"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.destroy();
  let errors = "";
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(errors, "");
  assert.equal(code, 1);
});

test("the HTML report hides rows the filters exclude", async () => {
  const { formatHtml } = await import("../src/report/html.js");
  const html = formatHtml({ root: "d", summary: { errors: 1, warnings: 0, suppressed: 0, pages: 1, stylesheets: 0, files: 1 }, findings: [{ rule: "a/b", severity: "error", message: "m", file: "f", line: 1, column: 1 }] });
  // A row has its own display value, so the hidden attribute needs a rule that outranks it.
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

