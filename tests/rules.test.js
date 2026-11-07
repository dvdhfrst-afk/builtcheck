// Edge cases per rule, beyond what the fixture sites cover. Most are false alarms that a
// real site would hit if the rule were naive.

import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { findingsFor, page, withSite } from "./helpers.js";

const lines = (found) => found.map((f) => f.line);
const messages = (found) => found.map((f) => f.message);
const ld = (object) => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
const context = { "@context": "https://schema.org" };

// ---- foundation

test("every default crawler is checked when the wildcard group blocks the site", () => {
  const found = findingsFor({ "robots.txt": "User-agent: *\nDisallow: /\n", "index.html": page("x") }, "foundation/robots-blocks-crawler");
  assert.equal(found.length, 10);
  for (const name of ["GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot", "Google-Extended", "Bytespider", "CCBot", "Applebot-Extended", "cohere-ai", "anthropic-ai"]) {
    assert.ok(found.some((f) => f.message.includes(name)), name);
  }
});

test("a partial block does not count as blocking the crawler", () => {
  const found = findingsFor({ "robots.txt": "User-agent: *\nDisallow: /private/\n", "index.html": page("x") }, "foundation/robots-blocks-crawler");
  assert.deepEqual(found, []);
});

test("the crawler list is configurable, and requireExplicit asks for a named group", () => {
  const files = { "robots.txt": "User-agent: *\nAllow: /\n\nUser-agent: MyBot\nDisallow: /\n", "index.html": page("x") };
  const config = { rules: { "foundation/robots-blocks-crawler": { crawlers: ["MyBot", "OtherBot"], requireExplicit: true } } };
  const found = findingsFor(files, "foundation/robots-missing", config);
  assert.deepEqual(messages(found).sort(), ['robots.txt blocks MyBot from the site ("Disallow: /")', "robots.txt has no User-agent group naming OtherBot"]);
});

test("robots.txt with no Sitemap line, a relative one, and a local one", () => {
  const check = (text) => findingsFor({ "robots.txt": text, "index.html": page("x") }, "foundation/robots-sitemap");
  assert.equal(check("User-agent: *\nAllow: /\n").length, 1);
  assert.ok(check("Sitemap: /sitemap.xml\n")[0].message.includes("not an absolute"));
  assert.ok(check("Sitemap: http://localhost:3000/sitemap.xml\n")[0].message.includes("local"));
});

test("llms.txt needs a title, and empty is reported", () => {
  const check = (text) => findingsFor({ "llms.txt": text, "index.html": page("x") }, "foundation/llms-txt-invalid");
  assert.deepEqual(check("\n\n# Title\n"), []);
  assert.equal(check("  \n\n").length, 1);
  assert.equal(check("\n#NoSpace\n")[0].line, 2);
});

test("a page matches the sitemap whichever way its URL is written", () => {
  const files = {
    "sitemap.xml": `<urlset>
      <url><loc>https://www.example.com</loc></url>
      <url><loc>https://example.com/a</loc></url>
      <url><loc>https://www.example.com/b/</loc></url>
      <url><loc>https://www.example.com/c/</loc></url>
      <url><loc>https://www.example.com/d.html</loc></url>
      <url><loc>https://www.example.com/caf%C3%A9/</loc></url>
    </urlset>`,
    "index.html": page("x"),
    "a.html": page("x"),
    "b/index.html": page("x"),
    "c.html": page("x"),
    "d.html": page("x"),
    "caf\u00e9/index.html": page("x"),
  };
  const config = { rules: { "foundation/sitemap-missing-page": "error", "foundation/sitemap-host": "error", "foundation/sitemap-noindex-url": "error" } };
  assert.deepEqual(findingsFor(files, "foundation/sitemap-stale-url", config), []);
});

test("error pages, noindex pages, redirects, verification files and excluded pages need no sitemap entry", () => {
  const files = {
    "sitemap.xml": "<urlset><url><loc>https://www.example.com/</loc></url></urlset>",
    "index.html": page("x"),
    "404.html": page("x"),
    "nested/404/index.html": page("x"),
    "none.html": page("x", '<meta name="ROBOTS" content="NOINDEX">'),
    "bot.html": page("x", '<meta name="googlebot" content="none">'),
    "moved.html": page("x", '<meta http-equiv="Refresh" content="0;url=/">'),
    "google1234abcd.html": "google-site-verification: google1234abcd.html",
    "dup.html": page("x", '<link rel="canonical" href="https://www.example.com/">'),
    "drafts/a.html": page("x"),
    "listed-not.html": page("x"),
  };
  const found = findingsFor(files, "foundation/sitemap-missing-page", {
    rules: { "foundation/sitemap-missing-page": { exclude: ["drafts/**"] } },
  });
  assert.deepEqual(found.map((f) => f.file), ["listed-not.html"]);
});

test("a sitemap URL on another host is reported against the configured site URL", () => {
  const files = { "sitemap.xml": "<urlset><url><loc>https://other.example/</loc></url></urlset>", "index.html": page("x") };
  const found = findingsFor(files, "foundation/sitemap-host", { site: { url: "https://www.example.com" } });
  assert.equal(found.length, 1);
});

test("www and bare host count as the same site", () => {
  const files = { "sitemap.xml": "<urlset><url><loc>https://example.com/</loc></url></urlset>", "index.html": page("x") };
  assert.deepEqual(findingsFor(files, "foundation/sitemap-host", { site: { url: "https://www.example.com" } }), []);
});

test("a sitemap URL that only redirects is stale, and externalPaths are trusted", () => {
  const files = {
    "sitemap.xml": "<urlset><url><loc>https://www.example.com/old</loc></url><url><loc>https://www.example.com/app/login</loc></url></urlset>",
    "_redirects": "/old /new 301\n",
    "index.html": page("x"),
  };
  const found = findingsFor(files, "foundation/sitemap-stale-url", { site: { externalPaths: ["/app/**"] } });
  assert.equal(found.length, 1);
  assert.ok(found[0].message.includes("only redirects"));
});

test("the default social image falls back to the image pages name most", () => {
  const tag = (src) => `<meta property="og:image" content="${src}">`;
  const files = {
    "cards/share.png": Buffer.from("not an image"),
    "one.png": Buffer.from("not an image"),
    "a.html": page("x", tag("/cards/share.png")),
    "b.html": page("x", tag("/cards/share.png")),
    "c.html": page("x", tag("/one.png")),
  };
  const found = findingsFor(files, "foundation/social-image-size");
  assert.deepEqual(found.map((f) => f.file), ["cards/share.png"]);
  assert.ok(found[0].message.includes("not a valid PNG or JPEG"));
});

test("a page naming only an image on another host is not reported as missing one", () => {
  const files = { "index.html": page("x", '<meta property="og:image" content="https://cdn.example.org/a.png">') };
  const config = { rules: { "foundation/page-social-image": "error", "foundation/page-social-image-broken": "error", "foundation/social-image-size": "error" } };
  assert.deepEqual(findingsFor(files, "foundation/social-image-missing", config), []);
});

test("the required social image size is configurable", () => {
  const png = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(800, 16);
  png.writeUInt32BE(400, 20);
  const files = { "og-default.png": png, "index.html": page("x") };
  assert.equal(findingsFor(files, "foundation/social-image-size").length, 1);
  assert.deepEqual(findingsFor(files, "foundation/social-image-size", { rules: { "foundation/social-image-size": { width: 800, height: 400 } } }), []);
});

// ---- schema

test("a block with several top-level objects is checked object by object", () => {
  const found = findingsFor({ "index.html": page("x", ld([{ ...context, "@type": "WebPage" }, { name: "no context or type" }])) }, "schema/missing-context", {
    rules: { "schema/missing-type": "error" },
  });
  assert.deepEqual(found.map((f) => f.rule).sort(), ["schema/missing-context", "schema/missing-type"]);
});

test("reference-only graph members need no type, others do", () => {
  const body = ld({ ...context, "@graph": [{ "@id": "#a" }, { name: "typeless" }, { "@type": "WebPage" }] });
  assert.equal(findingsFor({ "index.html": page("x", body) }, "schema/missing-type").length, 1);
});

test("every spelling of the schema.org context is accepted", () => {
  for (const value of ["http://schema.org", "https://schema.org/", ["https://schema.org", { a: "b" }], { "@vocab": "https://schema.org/" }]) {
    const body = ld({ "@context": value, "@type": "WebPage" });
    assert.deepEqual(findingsFor({ "index.html": page("x", body) }, "schema/missing-context"), [], JSON.stringify(value));
  }
  const other = ld({ "@context": "https://example.org/vocab", "@type": "WebPage" });
  assert.equal(findingsFor({ "index.html": page("x", other) }, "schema/missing-context").length, 1);
});

test("the type of a node may be an array, a full URL or a prefixed name", () => {
  for (const type of [["Thing", "Plumber"], "https://schema.org/Plumber", "http://schema.org/Plumber", "schema:Plumber"]) {
    const found = findingsFor({ "index.html": page("x", ld({ ...context, "@type": type, name: "N" })) }, "schema/required-field");
    assert.deepEqual(messages(found), ['Plumber "N" is missing "address"'], JSON.stringify(type));
    const wanted = findingsFor({ "index.html": page("x", ld({ ...context, "@type": type, name: "N" })) }, "schema/recommended-field");
    assert.equal(wanted.length, 3, JSON.stringify(type));
  }
});

test("empty values count as missing", () => {
  const object = { ...context, "@type": "Service", name: "   ", provider: {} };
  assert.equal(findingsFor({ "index.html": page("x", ld(object)) }, "schema/required-field").length, 1);
  assert.equal(findingsFor({ "index.html": page("x", ld(object)) }, "schema/recommended-field").length, 1);
  const list = { ...context, "@type": "FAQPage", mainEntity: [] };
  assert.equal(findingsFor({ "index.html": page("x", ld(list)) }, "schema/required-field").length, 1);
});

test("alternatives in a field list satisfy the requirement", () => {
  const object = { ...context, "@type": "Service", serviceType: "Drains", provider: { "@id": "#org" } };
  assert.deepEqual(findingsFor({ "index.html": page("x", ld(object)) }, "schema/required-field"), []);
});

test("a typed main entity is held to its requirements, other nested nodes are not", () => {
  const main = { ...context, "@type": "WebPage", mainEntity: { "@type": "Article", author: "A" } };
  assert.equal(findingsFor({ "index.html": page("x", ld(main)) }, "schema/required-field").length, 1);
  const nested = { ...context, "@type": "Service", name: "S", provider: { "@type": "LocalBusiness", name: "Short reference" } };
  assert.deepEqual(findingsFor({ "index.html": page("x", ld(nested)) }, "schema/required-field"), []);
});

test("untyped speakable and answer objects are still checked", () => {
  const speakable = { ...context, "@type": "WebPage", speakable: { other: 1 } };
  assert.equal(findingsFor({ "index.html": page("x", ld(speakable)) }, "schema/required-field").length, 1);
  const question = { ...context, "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Q?", acceptedAnswer: { text: "" , other: 1 } } };
  assert.equal(findingsFor({ "index.html": page("x", ld(question)) }, "schema/required-field").length, 1);
});

test("only the last breadcrumb may omit its link", () => {
  const object = {
    ...context,
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home" },
      { "@type": "ListItem", position: 2, item: { "@id": "/a/", name: "A" } },
      { "@type": "ListItem", position: 3, name: "Here" },
    ],
  };
  const found = findingsFor({ "index.html": page("x", ld(object)) }, "schema/required-field");
  assert.deepEqual(messages(found), ['ListItem "Home" is missing "item" (only the last breadcrumb may omit it)']);
});

test("required fields and subtypes are configurable, and one type can change alone", () => {
  const files = { "index.html": page("x", ld({ ...context, "@type": "Vet", name: "N" }) + ld({ ...context, "@type": "Service", name: "S" })) };
  const config = {
    rules: {
      "schema/required-field": { required: { LocalBusiness: ["telephone"] }, subtypes: { LocalBusiness: ["Vet"] } },
    },
  };
  const found = findingsFor(files, "schema/required-field", config);
  assert.deepEqual(messages(found).sort(), ['Vet "N" is missing "telephone"']);
  const elsewhere = { rules: { "schema/required-field": { required: { Service: ["serviceOutput"] } } } };
  const both = messages(findingsFor(files, "schema/required-field", elsewhere)).sort();
  assert.deepEqual(both, ['Service "S" is missing "serviceOutput"']);
});

test("schema/required-type does nothing until configured, then checks indexable pages", () => {
  const files = { "index.html": page("x", ld({ ...context, "@type": "WebPage" })), "404.html": page("x") };
  assert.deepEqual(findingsFor(files, "schema/required-type"), []);
  const found = findingsFor(files, "schema/required-type", { rules: { "schema/required-type": { types: ["BreadcrumbList"] } } });
  assert.deepEqual(found.map((f) => f.file), ["index.html"]);
});

test("an empty JSON-LD script is a parse error and still counts as having a block", () => {
  const found = findingsFor({ "index.html": page("x", '<script type="application/ld+json"></script>') }, "schema/invalid-json", { rules: { "schema/page-missing": "error" } });
  assert.deepEqual(found.map((f) => f.rule), ["schema/invalid-json"]);
});

test("script types are matched loosely and other scripts are ignored", () => {
  const files = { "index.html": page("x", '<script type=" Application/LD+JSON; charset=utf-8 ">{bad</script><script type="application/json">{bad</script><script>{bad</script>') };
  assert.equal(findingsFor(files, "schema/invalid-json").length, 1);
});

test("the question count threshold is configurable, and link-only headings on listing pages are not questions", () => {
  const questions = "<h2>One?</h2><p>a</p><h2>Two?</h2><p>b</p>";
  assert.deepEqual(findingsFor({ "index.html": page(questions) }, "schema/faq-content"), []);
  assert.equal(findingsFor({ "index.html": page(questions) }, "schema/faq-content", { rules: { "schema/faq-content": { minQuestions: 2 } } }).length, 1);
  const cards = `<h3><a href="/a">One?</a></h3><h3><a href="/b">Two?</a></h3><a href="/c"><h3>Three?</h3></a>`;
  assert.deepEqual(findingsFor({ "index.html": page(cards) }, "schema/faq-content"), []);
});

test("a blog post with an Article node is fine, and a listing page is not a post", () => {
  const post = ld({ ...context, "@type": "NewsArticle", headline: "H" });
  const files = {
    "blog/a/index.html": page("x", post),
    "blog/index.html": page("x"),
    "blog/tag/x/index.html": page("x"),
    "blog/category/y/index.html": page("x"),
    "blog/b.html": page("x"),
    "about/index.html": page("x"),
  };
  assert.deepEqual(findingsFor(files, "schema/blog-post-article").map((f) => f.file), ["blog/b.html"]);
});

test("blog paths are configurable", () => {
  const files = { "journal/a.html": page("x"), "blog/b.html": page("x") };
  const found = findingsFor(files, "schema/blog-post-article", { rules: { "schema/blog-post-article": { paths: ["journal/**"] } } });
  assert.deepEqual(found.map((f) => f.file), ["journal/a.html"]);
});

// ---- links

test("extensionless and folder-style links find their files", () => {
  const body = '<a href="a">1</a><a href="a/">2</a><a href="b">3</a><a href="b/">4</a><a href="/">5</a><a href=".">6</a><a href="./a.html?x#">7</a>';
  const files = { "index.html": page(body), "a.html": page("x"), "b/index.html": page("x") };
  assert.deepEqual(findingsFor(files, "links/broken-internal"), []);
});

test("relative links resolve against the folder of the page", () => {
  const files = {
    "a/b/index.html": page('<a href="../c/">ok</a><a href="c/">broken</a>'),
    "a/c/index.html": page("x"),
  };
  assert.deepEqual(messages(findingsFor(files, "links/broken-internal")), ["Link c/ does not resolve to any file in the build"]);
});

test("the base element changes how relative links resolve", () => {
  const files = { "a/b/index.html": page('<a href="c.html">ok</a>', '<base href="/x/">'), "x/c.html": page("x") };
  assert.deepEqual(findingsFor(files, "links/broken-internal"), []);
});

test("encoded paths and spaces resolve", () => {
  const files = { "index.html": page('<a href="my%20page.html">a</a><a href="caf%C3%A9.html">b</a><img src="bad%ZZ.png" alt="">'), "my page.html": page("x"), "caf\u00e9.html": page("x"), "bad%ZZ.png": "x" };
  const config = { rules: { "links/broken-asset": "error" } };
  assert.deepEqual(findingsFor(files, "links/broken-internal", config), []);
});

test("other schemes and other hosts are left alone", () => {
  const body = '<a href="mailto:a@example.com">1</a><a href="tel:1">2</a><a href="sms:1">3</a><a href="https://other.example/x">4</a><a href="//other.example/y">5</a><img src="data:image/png;base64,AA" alt="">';
  const config = { rules: { "links/broken-asset": "error" } };
  assert.deepEqual(findingsFor({ "index.html": page(body) }, "links/broken-internal", config), []);
});

test("absolute links to the site host are internal", () => {
  const files = { "index.html": page('<a href="https://www.example.com/gone">x</a><a href="https://example.com/">y</a>') };
  const found = findingsFor(files, "links/broken-internal", { site: { url: "https://www.example.com" } });
  assert.equal(found.length, 1);
});

test("the site host is inferred from canonical links when there is no sitemap", () => {
  const files = { "index.html": page('<a href="https://www.example.com/gone">x</a>', '<link rel="canonical" href="https://www.example.com/">') };
  assert.equal(findingsFor(files, "links/broken-internal").length, 1);
});

test("a configured base path applies, and paths outside it are left alone", () => {
  const files = { "index.html": page('<a href="/docs/a/">ok</a><a href="/docs/gone/">broken</a><a href="/other/">elsewhere</a>'), "a/index.html": page("x") };
  const found = findingsFor(files, "links/broken-internal", { site: { basePath: "/docs" } });
  assert.deepEqual(messages(found), ["Link /docs/gone/ does not resolve to any file in the build"]);
});

test("externalPaths and _redirects make a path valid", () => {
  const files = { "index.html": page('<a href="/api/x">a</a><a href="/old">b</a>'), "_redirects": "/old /new\n" };
  assert.deepEqual(findingsFor(files, "links/broken-internal", { site: { externalPaths: ["/api/**"] } }), []);
});

test("a canonical link and a meta refresh target are checked", () => {
  const head = '<link rel="canonical" href="/gone-a"><meta http-equiv="refresh" content="0; url=\'/gone-b\'">';
  assert.equal(findingsFor({ "index.html": page("x", head) }, "links/broken-internal").length, 2);
});

test("files excluded from the audit still count as existing", () => {
  const files = { "index.html": page('<a href="/skip/a.html">x</a>'), "skip/a.html": page("x") };
  assert.deepEqual(findingsFor(files, "links/broken-internal", { ignore: ["skip/**"] }), []);
});

test("anchors work with encoded ids, text fragments and top", () => {
  const body = '<h2 id="caf\u00e9">x</h2><a href="#caf%C3%A9">1</a><a href="#TOP">2</a><a href="#:~:text=hello">3</a><a href="#caf%C3%A9:~:text=x">4</a>';
  assert.deepEqual(findingsFor({ "index.html": page(body) }, "links/missing-anchor"), []);
});

test("ids are case sensitive", () => {
  assert.equal(findingsFor({ "index.html": page('<h2 id="Part">x</h2><a href="#part">y</a>') }, "links/missing-anchor").length, 1);
});

test("a fragment on a link to a file that is not a page is not checked", () => {
  const files = { "index.html": page('<a href="/a.pdf#page=2">x</a>'), "a.pdf": "x" };
  assert.deepEqual(findingsFor(files, "links/missing-anchor"), []);
});

test("srcset candidates split the way browsers split them", () => {
  const files = { "index.html": page('<img alt="" srcset="/a,b.png 1x, /c.png 2x,/d.png 3x"><source srcset="/e.png">') };
  const found = findingsFor(files, "links/broken-asset");
  assert.deepEqual(messages(found).map((m) => m.split(" ")[2]).sort(), ["/a,b.png", "/c.png", "/d.png", "/e.png"]);
});

test("stylesheet references resolve against the stylesheet, block styles against the page", () => {
  const files = {
    "css/a.css": 'a{background:url(../img/ok.png);mask:url(#clip)}b{src:url("/fonts/x.woff2?v=1#iefix")}c{background:url(ok.png)}@import url(gone.css);',
    "img/ok.png": "x",
    "fonts/x.woff2": "x",
    "sub/index.html": page('<style>a{background:url(../img/ok.png)}</style><p style="background:url(missing.png)">x</p>'),
  };
  const found = findingsFor(files, "links/broken-asset");
  assert.deepEqual(
    found.map((f) => `${f.file} ${f.message.split(" ")[2]}`).sort(),
    ["css/a.css gone.css", "css/a.css ok.png", "sub/index.html missing.png"],
  );
});

test("text inside the content property is not a file reference", () => {
  assert.deepEqual(findingsFor({ "a.css": 'a::before{content:"url(nope.png)"}', "index.html": page("x") }, "links/broken-asset"), []);
});

test("preconnect and DNS prefetch hints are not asset references", () => {
  const head = '<link rel="preconnect" href="/nothing"><link rel="dns-prefetch" href="/nothing"><link rel="me" href="/nothing">';
  assert.deepEqual(findingsFor({ "index.html": page("x", head) }, "links/broken-asset"), []);
});

test("generic link text with a nested span, an aria-label and a capitalized phrase is recognized", () => {
  const body = `<a href="#">READ <b>MORE</b></a><a href="#" aria-label="Learn more"><svg></svg></a><a href="#"><img src="a.png" alt="Click here"></a><a href="#">Read more about drains</a>`;
  assert.equal(findingsFor({ "index.html": page(body), "a.png": "x" }, "links/generic-no-destination").length, 4);
});

test("words that merely start like a phrase are not generic", () => {
  assert.deepEqual(findingsFor({ "index.html": page('<a href="#">Detailsmith</a><a href="#">Read moreover</a>') }, "links/generic-no-destination"), []);
});

test("scripted controls and real destinations are not reported", () => {
  const body = `<a href="#" role="button">Read more</a><a href="#" aria-expanded="false">Read more</a><a href="#" onclick="go()">Read more</a><a href="#" data-bs-toggle="x">Read more</a><a href="/a.html">Read more</a><a href="#part">Read more</a><p id="part"></p>`;
  const config = { rules: { "links/placeholder-href": "error" } };
  assert.deepEqual(findingsFor({ "index.html": page(body), "a.html": page("x") }, "links/generic-no-destination", config), []);
});

test("generic phrases are configurable, and the placeholder rule follows them", () => {
  const files = { "index.html": page('<a href="#">Mehr lesen</a><a href="#">Read more</a>') };
  const config = { rules: { "links/generic-no-destination": { phrases: ["mehr lesen"] }, "links/placeholder-href": "error" } };
  const found = findingsFor(files, "links/broken-internal", config);
  assert.deepEqual(found.map((f) => f.rule).sort(), ["links/generic-no-destination", "links/placeholder-href"]);
});

test("the placeholder rule reports generic text when the generic rule is off", () => {
  const files = { "index.html": page('<a href="#">Read more</a>') };
  const found = findingsFor(files, "links/placeholder-href", { rules: { "links/generic-no-destination": "off" } });
  assert.equal(found.length, 1);
});

test("do-nothing javascript links are placeholders, working ones are not", () => {
  const body = '<a href="javascript:void(0);">a</a><a href="javascript:;">b</a><a href="#!">c</a><a href="javascript:openMenu()">d</a>';
  assert.equal(findingsFor({ "index.html": page(body) }, "links/placeholder-href").length, 3);
});

// ---- copy

test("each em dash on a line is its own finding, at its own column", () => {
  const source = "<p>a &mdash; b \u2014 c</p>";
  const found = findingsFor({ "index.html": source }, "copy/em-dash");
  assert.equal(found.length, 2);
  assert.equal(source.slice(found[0].column - 1, found[0].column + 6), "&mdash;");
  assert.equal(source[found[1].column - 1], "\u2014");
});

test("a dash outside visible text is not copy, in a script, style, attribute, comment or code", () => {
  const dash = "\u2014";
  const body = `<script>var a = "${dash}";</script><style>a::before{content:"${dash}"}</style><p title="${dash}">x</p><!-- ${dash} --><code>${dash}</code>`;
  assert.deepEqual(findingsFor({ "index.html": page(body) }, "copy/em-dash"), []);
});

test("the characters counted as dashes are configurable", () => {
  const files = { "index.html": page("<p>2020\u20132024 and a \u2014 b</p>") };
  assert.equal(findingsFor(files, "copy/em-dash").length, 1);
  const found = findingsFor(files, "copy/em-dash", { rules: { "copy/em-dash": { characters: ["\u2013"] } } });
  assert.equal(found.length, 1);
  assert.ok(found[0].message.startsWith("En dash"));
});

test("hyphen patterns: dashes are reported, flags and rules are not", () => {
  const report = ["a -- b", "a-- b", "a --b -- c", "ends --", "-- starts here", "x--y"];
  for (const text of report) {
    assert.ok(findingsFor({ "index.html": page(`<p>${text}</p>`) }, "copy/double-hyphen").length >= 1, text);
  }
  const clean = ["--verbose", "run (--verbose) now", "a --- b", "-----", "<!-- c -->", "a -&gt; b", "&lt;-- back", "forth --&gt;", "See https://x.example/a--b/c now", "xn--bcher-kva.example", "my--file.txt"];
  for (const text of clean) {
    assert.deepEqual(findingsFor({ "index.html": page(`<p>${text}</p>`) }, "copy/double-hyphen"), [], text);
  }
});

test("headings repeated at a breakpoint, in a footer or in navigation are not duplicates", () => {
  const body = `<h2 class="hidden md:block">Plans</h2><h2 class="md:hidden">Plans</h2><h2>About</h2><footer><h3>About</h3></footer><nav><h2>About</h2></nav><div class="lg:hidden"><h2>About</h2></div>`;
  assert.deepEqual(findingsFor({ "index.html": page(body) }, "copy/duplicate-heading"), []);
});

test("heading comparison ignores nested markup, spacing and case, and skips empty headings", () => {
  const body = "<h2>Our  <em>Work</em></h2><h2>our work</h2><h2></h2><h2><img src='a.png' alt=''></h2>";
  assert.equal(findingsFor({ "index.html": page(body), "a.png": "x" }, "copy/duplicate-heading").length, 1);
});

test("the checked heading levels are configurable", () => {
  const body = "<h4>Features</h4><h4>Features</h4>";
  assert.deepEqual(findingsFor({ "index.html": page(body) }, "copy/duplicate-heading"), []);
  assert.equal(findingsFor({ "index.html": page(body) }, "copy/duplicate-heading", { rules: { "copy/duplicate-heading": { levels: [4] } } }).length, 1);
});

test("a heading wrapped in a section with a repeating subhead is found, and a longer subhead is fine", () => {
  const same = "<header><h1>Pipes</h1></header><p class='lede'>Pipes</p>";
  assert.equal(findingsFor({ "index.html": page(same) }, "copy/duplicate-subhead").length, 1);
  const different = "<h1>Pipes</h1><p>Pipes that last</p>";
  assert.deepEqual(findingsFor({ "index.html": page(different) }, "copy/duplicate-subhead"), []);
});

test("placeholder patterns catch what they should and leave real copy alone", () => {
  const report = ["FIXME", "Date: TBD", "XXX", "XXXX-XXXX", "text goes here", "sample text", "Your Company Name, all rights reserved", "{% if x %}", "Insert your logo here", "user@example.com", "000-000-0000", "123-456-7890", "${name}", "<%= name %>", "NaN", "null", "[FILL: title]", "[Your name]", "(555) 555-1234"];
  for (const text of report) {
    const safe = text.replace(/</g, "&lt;");
    assert.equal(findingsFor({ "index.html": page(`<p>${safe}</p>`) }, "copy/placeholder-text").length, 1, text);
  }
  const clean = ["A todo list", "Coming soon to Sampleville", "null and void", "NaN is a number", "our XXL van", "Enter your email here", "Call (801) 555-0100", "[Note: open daily]", "hello@example.com", "We replace furnaces right here in Ogden.", "Replace your old water heater here and save.", "Insert the new filter here, arrow toward the blower.", "We print your business name on every truck.", "Get your company name on the map.", "Text us a sample text and we reply in minutes.", "Super Bowl XXX was in Tempe."];
  for (const text of clean) {
    assert.deepEqual(findingsFor({ "index.html": page(`<p>${text}</p>`) }, "copy/placeholder-text"), [], text);
  }
});

test("placeholder patterns can be added to or replaced", () => {
  const files = { "index.html": page("<p>Acme Widgets TODO</p>") };
  assert.equal(findingsFor(files, "copy/placeholder-text", { rules: { "copy/placeholder-text": { extraPatterns: ["Acme Widgets"] } } }).length, 2);
  const replaced = findingsFor(files, "copy/placeholder-text", { rules: { "copy/placeholder-text": { patterns: [{ pattern: "acme", flags: "i", label: "sample brand" }] } } });
  assert.deepEqual(messages(replaced), ['Placeholder text (sample brand): "Acme Widgets TODO"']);
});

// ---- style

test("pure colors are found in style blocks, files and attributes, with the right line", () => {
  const files = { "index.html": "<style>\n\n.a{color:#000}\n</style>\n<p class='a' style='color:white'>x<b>y</b></p>", "a.css": "\n\nb{color:#fff}" };
  const found = findingsFor(files, "style/pure-color");
  assert.deepEqual(found.map((f) => `${f.file}:${f.line}`), ["a.css:3", "index.html:3", "index.html:5"]);
});

test("only color properties are read for pure colors", () => {
  const css = "a{font-family:black;grid-area:white;animation-name:white;content:'white';transition:color .2s;background:var(--a,#123)}";
  assert.deepEqual(findingsFor({ "a.css": css, "index.html": page("x") }, "style/pure-color"), []);
});

test("custom properties are checked, except the ignored ones", () => {
  const files = { "a.css": ":root{--tw-shadow-color:#000;--ink:#000}", "index.html": page("x") };
  assert.deepEqual(lines(findingsFor(files, "style/pure-color")).length, 1);
  assert.deepEqual(findingsFor(files, "style/pure-color", { rules: { "style/pure-color": { ignoreProperties: ["--ink", "--tw-*"] } } }), []);
});

test("files and third party widget selectors can be excluded from color checks", () => {
  const files = { "vendor/x.css": "a{color:#000}", "map.css": ".maplibregl-popup{background:#fff}.mine-popup{background:#fff}", "index.html": page('<div class="maplibregl-popup"></div><div class="mine-popup"></div><a>x</a>') };
  const found = findingsFor(files, "style/pure-color", { rules: { "style/pure-color": { ignoreFiles: ["vendor/**"] } } });
  assert.deepEqual(messages(found), ["Pure white (#fff) in background of .mine-popup"]);
});

test("a banned font is reported only as the first choice, unless asked", () => {
  const files = { "a.css": "a{font-family:Georgia,Inter,serif}b{font-family:'Inter Variable',serif}c{font-family:Inter Tight}", "index.html": page("<a>x</a><b>y</b><c>z</c>") };
  assert.equal(findingsFor(files, "style/banned-font").length, 1);
  assert.equal(findingsFor(files, "style/banned-font", { rules: { "style/banned-font": { checkFallbacks: true } } }).length, 2);
});

test("the banned font list is configurable", () => {
  const files = { "a.css": "a{font-family:Papyrus}b{font-family:Inter}", "index.html": page("<a>x</a><b>y</b>") };
  const found = findingsFor(files, "style/banned-font", { rules: { "style/banned-font": { fonts: ["papyrus"] } } });
  assert.deepEqual(lines(found), [1]);
  assert.ok(found[0].message.includes("Papyrus"));
});

test("a banned font loaded from a web font service is reported, from a page and from CSS", () => {
  const files = {
    "index.html": page("x", '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&amp;display=swap">'),
    "a.css": '@import url("https://fonts.googleapis.com/css2?family=Roboto");@import url("https://fonts.googleapis.com/css2?family=Lora");',
  };
  assert.deepEqual(findingsFor(files, "style/banned-font").map((f) => f.file), ["a.css", "index.html"]);
});

test("grid overflow arithmetic follows the phone width", () => {
  const check = (classes, config) => findingsFor({ "index.html": page(`<div class="${classes}">x</div>`) }, "style/phone-overflow", config);
  assert.equal(check("grid-cols-12 gap-10").length, 1);
  assert.deepEqual(check("grid-cols-12 gap-8"), []);
  assert.deepEqual(check("grid-cols-1 gap-10"), []);
  assert.deepEqual(check("grid-cols-12"), []);
  assert.deepEqual(check("grid-cols-12 gap-y-10"), []);
  assert.deepEqual(check("grid-cols-12 gap-10 gap-x-2"), []);
  assert.equal(check("grid-cols-12 gap-[2.5rem]").length, 1);
  assert.equal(check("grid-cols-[repeat(12,minmax(0,1fr))] gap-10").length, 1);
  assert.equal(check("grid-cols-12 gap-8", { rules: { "style/phone-overflow": { phoneWidth: 320 } } }).length, 1);
});

test("breakpoint variants mean the class does not reach a phone, or that a phone gets an override", () => {
  const check = (html) => findingsFor({ "index.html": page(html) }, "style/phone-overflow");
  assert.deepEqual(check('<div class="md:grid-cols-12 md:gap-10">x</div>'), []);
  assert.deepEqual(check('<div class="grid-cols-12 gap-2 md:gap-10">x</div>'), []);
  assert.deepEqual(check('<div class="grid-cols-12 gap-10 max-md:grid-cols-1">x</div>'), []);
  assert.deepEqual(check('<div class="hidden md:grid grid-cols-12 gap-10">x</div>'), []);
  assert.deepEqual(check('<div class="hidden md:block"><div class="grid-cols-12 gap-10">x</div></div>'), []);
});

test("scrolling or clipping wrappers and positioned decoration are exempt from width checks", () => {
  const check = (html) => findingsFor({ "index.html": page(html) }, "style/phone-overflow");
  assert.deepEqual(check('<div class="overflow-hidden"><div class="w-[600px]">x</div></div>'), []);
  assert.deepEqual(check('<div class="absolute w-[800px]">x</div>'), []);
  assert.equal(check('<div class="w-[600px] overflow-hidden">x</div>').length, 1);
  assert.deepEqual(check('<div class="w-[50vw]">x</div><div class="w-[100%]">y</div><div class="w-[390px]">z</div>'), []);
  assert.equal(check('<div class="min-w-[30rem] max-w-full">x</div>').length, 1);
});

test("extra class patterns can be configured", () => {
  const files = { "index.html": page('<div class="w-screen md:bad">x</div>') };
  const config = { rules: { "style/phone-overflow": { classPatterns: [{ pattern: "^w-screen$", message: "ignores scrollbars" }, "^bad$"] } } };
  assert.deepEqual(messages(findingsFor(files, "style/phone-overflow", config)), ["w-screen: ignores scrollbars"]);
});

test("CSS grids are checked by the media query they sit in", () => {
  const check = (css) => findingsFor({ "a.css": css, "index.html": page('<div class="g">x</div>') }, "style/phone-overflow");
  assert.equal(check(".g{grid-template-columns:repeat(12,1fr);gap:40px}").length, 1);
  assert.equal(check(".g{grid-template-columns:repeat(12,1fr);column-gap:2.5rem}").length, 1);
  assert.equal(check(".g{grid-template-columns:repeat(12,1fr);gap:0 40px}").length, 1);
  assert.deepEqual(check(".g{grid-template-columns:repeat(12,1fr);gap:40px 8px}"), []);
  assert.equal(check(".g{grid-template-columns:1fr 1fr 1fr 1fr 1fr 1fr;gap:100px}").length, 1);
  assert.deepEqual(check("@media (min-width:768px){.g{grid-template-columns:repeat(12,1fr);gap:40px}}"), []);
  assert.deepEqual(check("@media (width >= 48rem){.g{grid-template-columns:repeat(12,1fr);gap:40px}}"), []);
  assert.deepEqual(check("@media print{.g{grid-template-columns:repeat(12,1fr);gap:40px}}"), []);
  assert.deepEqual(check(".g{grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:40px}"), []);
  assert.deepEqual(check(".g{grid-template-columns:repeat(12,1fr);gap:2%}"), []);
  assert.deepEqual(check(".g{grid-template-columns:repeat(12,1fr);gap:40px}@media (max-width:767px){.g{grid-template-columns:1fr}}"), []);
  assert.equal(check(".g{grid-template-columns:repeat(12,1fr);gap:40px}@media (max-width:767px){.other{grid-template-columns:1fr}}").length, 1);
});

// ---- engine behavior

test("ignore-file and rule groups in comments work in every file type", () => {
  const files = {
    "index.html": "<!-- builtcheck-ignore-file copy/em-dash -->\n<p>a &mdash; b</p>\n<p>c -- d<b>e</b></p>",
    "a.css": "/*! builtcheck-ignore-file */\nb{color:#000}",
    "b.css": "/* builtcheck-ignore-file style/banned-font */\nb{color:#000}",
    "robots.txt": "User-agent: *\n# builtcheck-ignore-next-line foundation/robots-blocks-crawler\nDisallow: /\n# builtcheck-ignore-file foundation/robots-sitemap\n",
  };
  const result = withSite(files, (root) =>
    audit(root, { rules: { "*": "off", "copy/*": "warning", "style/pure-color": "warning", "foundation/robots-blocks-crawler": "error", "foundation/robots-sitemap": "error" } }),
  );
  assert.deepEqual(result.findings.map((f) => `${f.file} ${f.rule}`).sort(), ["b.css style/pure-color", "index.html copy/double-hyphen"]);
  assert.ok(result.summary.suppressed >= 3);
});

test("an ignore comment naming another rule, or text that only mentions a directive, ignores nothing", () => {
  const files = {
    "index.html": "<!-- builtcheck-ignore-next-line copy/double-hyphen -->\n<p>a &mdash; b</p>\n<p>Write builtcheck-ignore-file in a comment &mdash; like so.</p>",
  };
  assert.equal(findingsFor(files, "copy/em-dash").length, 2);
});

test("an ignore comment can give a reason after two hyphens", () => {
  const files = { "index.html": "<!-- builtcheck-ignore-next-line copy/em-dash -- quoted from a book -->\n<p>a &mdash; b</p>" };
  assert.deepEqual(findingsFor(files, "copy/em-dash"), []);
});

test("an ignored element covers everything inside it, even all on one line", () => {
  const files = { "index.html": '<!-- builtcheck-ignore-next-element --><div><p>a &mdash; b</p><p>TODO</p></div><p>c &mdash; d</p>' };
  const result = withSite(files, (root) => audit(root, { rules: { "*": "off", "copy/*": "error" } }));
  assert.equal(result.findings.length, 1);
  assert.equal(result.summary.suppressed, 2);
});

test("identical findings on a line are reported once, and output is sorted", () => {
  const files = { "b.html": page("x"), "a.html": page('<a href="/n">1</a>') + '\n<a href="/n">2</a>' };
  const found = findingsFor(files, "links/broken-internal");
  assert.equal(found.length, 2);
  assert.deepEqual(found.map((f) => f.line), [1, 2]);
});

test("a severity can change without touching options", () => {
  const files = { "index.html": page("<p>a &mdash; b</p>") };
  const result = withSite(files, (root) => audit(root, { rules: { "*": "off", "copy/em-dash": { severity: "error", characters: ["\u2014"] } } }));
  assert.equal(result.summary.errors, 1);
});

test("a byte order mark at the start of a file does no harm", () => {
  const files = { "index.html": "\ufeff<!doctype html><title>x</title><p>a</p>", "robots.txt": "\ufeffUser-agent: *\nDisallow: /\n" };
  const result = withSite(files, (root) => audit(root, { rules: { "*": "off", "foundation/robots-blocks-crawler": "error" } }));
  assert.equal(result.findings.length, 10);
});
