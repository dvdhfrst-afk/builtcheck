// Pages written by hand to follow the markup static site generators are known to produce. These
// are not real generator output: they protect against false alarms on the shapes each one uses.

import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { withSite } from "./helpers.js";

const NOT_GAPS = (finding) => !/^foundation\/|^schema\/page-missing$|^schema\/recommended-field$|^schema\/blog-post-article$/.test(finding.rule);

function problems(files, config = {}) {
  return withSite(files, (root) => {
    const result = audit(root, config);
    return { site: result.site, errors: result.findings.filter(NOT_GAPS).map((f) => `${f.rule} ${f.file}:${f.line} ${f.message}`), all: result.findings };
  });
}

const NEXT_HEAD = (base) => `<meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><link rel="preload" href="${base}/_next/static/media/font.woff2" as="font" crossorigin="" type="font/woff2"/><link rel="stylesheet" href="${base}/_next/static/css/app.css" data-precedence="next"/><link rel="preload" as="script" fetchPriority="low" href="${base}/_next/static/chunks/webpack.js"/><script src="${base}/_next/static/chunks/main.js" async=""></script><title>Create</title><meta name="description" content="Generated"/><link rel="icon" href="${base}/favicon.ico?favicon.0b3bf435.ico" sizes="48x48" type="image/x-icon"/><meta name="next-size-adjust" content=""/>`;

function nextFiles(base = "") {
  const shell = (body) => `<!DOCTYPE html><html lang="en"><head>${NEXT_HEAD(base)}</head><body class="__variable_abc antialiased"><div hidden=""><!--$--><!--/$--></div>${body}<script src="${base}/_next/static/chunks/main.js" async=""></script><script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"1:\\"$Sreact.fragment\\"\\n2:{\\"a\\":\\"TODO -- not copy\\"}"])</script></body></html>`;
  return {
    "index.html": shell(`<main class="grid grid-rows-[20px_1fr_20px] sm:p-20"><img alt="Logo" width="180" height="38" decoding="async" data-nimg="1" style="color:transparent" src="${base}/next.svg"/><a href="${base}/about">About</a><a href="${base}/blog/first-post">First</a><a href="${base}/blog/second-post/">Second</a><template id="B:0"></template><div hidden id="S:0"><p>Streamed</p></div></main>`),
    "about.html": shell(`<main><h1>About</h1><img alt="" srcSet="${base}/photo.png 1x, ${base}/photo.png 2x" src="${base}/photo.png"/></main>`),
    "blog/first-post.html": shell(`<main><h1>First</h1><a href="${base}/">Home</a></main>`),
    "blog/second-post/index.html": shell(`<main><h1>Second</h1><a href="${base}/">Home</a></main>`),
    "404.html": shell("<h1>404</h1><h2>This page could not be found.</h2>"),
    "_not-found.html": shell("<h1>404</h1><h2>This page could not be found.</h2>"),
    "index.txt": "1:\"$Sreact.fragment\"\n",
    "_next/static/css/app.css": ":root{--background:#fff;--foreground:#171717}body{background:var(--background);color:var(--foreground)}.grid{display:grid}.__variable_abc{--font-geist:'Geist','Geist Fallback'}",
    "_next/static/media/font.woff2": "x",
    "_next/static/chunks/main.js": "x",
    "_next/static/chunks/webpack.js": "x",
    "favicon.ico": "x",
    "next.svg": "<svg/>",
    "photo.png": "x",
  };
}

test("a Next static export is free of false alarms", () => {
  const { errors, all } = problems(nextFiles());
  assert.deepEqual(errors.filter((line) => !line.startsWith("style/pure-color")), []);
  assert.ok(!all.some((f) => f.file === "_not-found.html" || f.file === "404.html"), "error pages are not content");
});

test("a Next static export under a base path, with no sitemap, finds the base path itself", () => {
  const { site, errors } = problems(nextFiles("/docs"));
  assert.equal(site.basePath, "/docs");
  assert.deepEqual(errors.filter((line) => !line.startsWith("style/pure-color")), []);
});

test("a missing folder is not mistaken for a base path when the files are missing too", () => {
  const body = '<a href="/shop/a">a</a><a href="/shop/b">b</a><a href="/shop/c">c</a>';
  const { site, errors } = problems({ "index.html": `<title>t</title><main>${body}</main>` });
  assert.equal(site.basePath, "/");
  assert.equal(errors.length, 3);
});

test("real broken links do not stop a base path being found, but too many do", () => {
  const found = problems({ "index.html": '<a href="/d/x">x</a><a href="/d/y">y</a><a href="/d/z">z</a><a href="/d/w">w</a><a href="/d/nope">n</a>', "x.html": "", "y.html": "", "z.html": "", "w.html": "" });
  assert.equal(found.site.basePath, "/d");
  assert.deepEqual(found.errors.map((line) => line.split(" ")[0]), ["links/broken-internal"]);
  const mixed = problems({ "index.html": '<a href="/d/x">x</a><a href="/d/nope">n</a><a href="/d/gone">g</a>', "x.html": "" });
  assert.equal(mixed.site.basePath, "/");
});

test("Hugo style output with unquoted attributes and absolute URLs is free of false alarms", () => {
  const shell = (body) => `<!doctype html><html lang=en-us><head><meta charset=utf-8><meta name=generator content="Hugo"><title>Site</title><link rel=canonical href=https://example.org/posts/first/><link rel=stylesheet href=/css/main.min.css><link rel=alternate type=application/rss+xml href=/index.xml title=Site><meta property="og:image" content="https://example.org/images/og.png"></head><body>${body}</body></html>`;
  const { errors } = problems({
    "index.html": shell('<nav><a href=https://example.org/posts/>Posts</a><a href=https://example.org/tags/>Tags</a></nav>'),
    "posts/index.html": shell('<a href=/posts/first/>First</a><a href=/posts/page/2/>Next</a><a href=https://gohugo.io>Hugo</a>'),
    "posts/page/2/index.html": shell('<a href=/posts/first/>First</a>'),
    "posts/first/index.html": shell('<article><h1>First</h1><h2 id=one>One</h2><a href=#one>One</a><a href=/posts/first/#one>Again</a><pre><code>a -- b TODO</code></pre></article>'),
    "tags/index.html": shell("<h1>Tags</h1>"),
    "categories/index.html": shell("<h1>Categories</h1>"),
    "404.html": shell("<h1>404</h1>"),
    "index.xml": "<rss/>",
    "css/main.min.css": "body{margin:0}",
    "images/og.png": "x",
    "sitemap.xml": '<?xml version="1.0" encoding="utf-8" standalone="yes"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"><url><loc>https://example.org/categories/</loc></url><url><loc>https://example.org/</loc><lastmod>2026-01-01</lastmod></url><url><loc>https://example.org/posts/first/</loc></url><url><loc>https://example.org/posts/</loc></url><url><loc>https://example.org/tags/</loc></url></urlset>',
  });
  assert.deepEqual(errors, []);
});

test("Eleventy style output is free of false alarms", () => {
  const shell = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blog</title><meta name="generator" content="Eleventy"><link rel="alternate" href="/feed/feed.xml" type="application/atom+xml" title="Blog"><style>.visually-hidden:not(:focus):not(:active){clip:rect(0 0 0 0);position:absolute;width:1px}</style></head><body><a href="#main" id="skip-link" class="visually-hidden">Skip to main content</a><header><a href="/" class="home-link">Blog</a></header><main id="main">${body}</main></body></html>`;
  const { errors } = problems({
    "index.html": shell('<h1>Latest</h1><ol reversed class="postlist"><li><a href="/blog/fifthpost/" class="postlist-link">Fifth</a><time datetime="2026-01-01">Jan</time></li></ol>'),
    "blog/index.html": shell('<a href="/blog/fifthpost/">Fifth</a>'),
    "blog/fifthpost/index.html": shell('<h1 id="fifth">Fifth</h1><picture><source type="image/avif" srcset="/img/a-600.avif 600w, /img/a-1200.avif 1200w" sizes="auto"><img loading="lazy" decoding="async" src="/img/a-600.jpeg" alt="A" width="600" height="400"></picture><a href="#fifth" class="header-anchor">#</a><a href="/tags/second-tag/" class="post-tag">second tag</a>'),
    "tags/second-tag/index.html": shell("<h1>Tagged</h1>"),
    "feed/feed.xml": "<feed/>",
    "img/a-600.avif": "x",
    "img/a-1200.avif": "x",
    "img/a-600.jpeg": "x",
    "sitemap.xml": '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/blog/</loc></url><url><loc>https://example.com/blog/fifthpost/</loc></url><url><loc>https://example.com/tags/second-tag/</loc></url></urlset>',
  });
  assert.deepEqual(errors, []);
});

test("Astro style output is free of false alarms", () => {
  const shell = (body) => `<!DOCTYPE html><html lang="en" data-astro-cid-abc><head><meta charset="utf-8"><link rel="sitemap" href="/sitemap-index.xml"><link rel="alternate" type="application/rss+xml" title="B" href="https://example.com/rss.xml"><link rel="canonical" href="https://example.com/"><title>B</title><meta property="og:image" content="https://example.com/blog-placeholder-1.jpg"><link rel="stylesheet" href="/_astro/index.abc.css"><script type="module" src="/_astro/hoisted.abc.js"></script></head><body>${body}</body></html>`;
  const { errors } = problems({
    "index.html": shell('<astro-island uid="1" component-url="/_astro/C.js" client="load"><a href="/blog/" data-astro-cid-abc>Blog</a></astro-island>'),
    "blog/index.html": shell('<a href="/blog/first/">F</a><img width="720" height="360" src="/_astro/hero.abc.jpg" alt="">'),
    "blog/first/index.html": shell('<h1>F</h1><h2 id="x">X</h2><a href="#x">X</a>'),
    "_astro/index.abc.css": "body{margin:0}",
    "_astro/hoisted.abc.js": "x",
    "_astro/hero.abc.jpg": "x",
    "blog-placeholder-1.jpg": "x",
    "rss.xml": "<rss/>",
    "sitemap-index.xml": '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://example.com/sitemap-0.xml</loc></sitemap></sitemapindex>',
    "sitemap-0.xml": '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url><url><loc>https://example.com/blog/</loc></url><url><loc>https://example.com/blog/first/</loc></url></urlset>',
  });
  assert.deepEqual(errors, []);
});

test("Docusaurus style output is free of false alarms", () => {
  const shell = (body) => `<!doctype html><html lang="en" dir="ltr" class="docs-wrapper"><head><meta charset="UTF-8"><title>D</title><link data-rh="true" rel="icon" href="/img/favicon.ico"><link data-rh="true" rel="canonical" href="https://your.example.com/docs/intro"><link data-rh="true" rel="alternate" href="https://your.example.com/docs/intro" hreflang="en"><link rel="alternate" type="application/rss+xml" href="/blog/rss.xml"><link rel="stylesheet" href="/assets/css/styles.abc.css"><script src="/assets/js/runtime~main.abc.js" defer="defer"></script></head><body class="navigation-with-keyboard"><div role="region" aria-label="Skip to main content"><a class="skipToContent" href="#__docusaurus_skipToContent_fallback">Skip to main content</a></div><div id="__docusaurus"><main id="__docusaurus_skipToContent_fallback">${body}</main></div></body></html>`;
  const { errors } = problems({
    "index.html": shell('<a href="/docs/intro">Tutorial</a><a class="navbar__link" href="https://github.com/example">GitHub</a><a aria-haspopup="true" aria-expanded="false" role="button" class="navbar__link" href="#">Community</a>'),
    "docs/intro/index.html": shell('<h1>Intro</h1><h2 class="anchor" id="getting-started">Getting Started<a href="#getting-started" class="hash-link" aria-label="Direct link" title="Direct link"></a></h2><a href="/docs/intro#getting-started">Again</a>'),
    "blog/rss.xml": "<rss/>",
    "404.html": shell("<h1>Page Not Found</h1>"),
    "img/favicon.ico": "x",
    "assets/css/styles.abc.css": "body{margin:0}",
    "assets/js/runtime~main.abc.js": "x",
    "sitemap.xml": '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://your.example.com/docs/intro</loc></url><url><loc>https://your.example.com/</loc></url></urlset>',
  });
  assert.deepEqual(errors, []);
});

test("application fallback shells are not content pages", () => {
  for (const file of ["200.html", "fallback.html", "_error.html", "not-found.html", "404/index.html"]) {
    const { all } = problems({ [file]: "<title>t</title><div id=app></div>", "index.html": "<title>t</title><h1>Home</h1>", "sitemap.xml": "<urlset><url><loc>https://www.example.com/</loc></url></urlset>" });
    assert.ok(!all.some((f) => f.file === file), file);
  }
});
