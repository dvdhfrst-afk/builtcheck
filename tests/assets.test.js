// Asset and page weight rules: byte budgets, image sizes on the page, render-blocking scripts,
// font loading, duplicate files and mixed content.

import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { srcsetCandidates } from "../src/rules/assets.js";
import { findingsFor, page, withFixtureSite, withSite } from "./helpers.js";
import { jpeg, png, svg, webpLossy } from "./image-bytes.js";

const messages = (findings) => findings.map((finding) => finding.message);
const KB = 1024;

test("large-image reports image files over the budget, whatever their format", () => {
  const files = { "index.html": page("x"), "big.jpg": jpeg(10, 10, 600 * KB), "small.png": png(10, 10, 100 * KB), "hero.webp": webpLossy(10, 10) };
  const findings = findingsFor(files, "assets/large-image");
  assert.deepEqual(findings.map((finding) => finding.file), ["big.jpg"]);
  assert.match(findings[0].message, /^Image is 600 KB, over the 500 KB budget/);
  const tighter = findingsFor(files, "assets/large-image", { rules: { "assets/large-image": { maxKilobytes: 50 } } });
  assert.deepEqual(tighter.map((finding) => finding.file), ["big.jpg", "small.png"]);
});

test("large-image leaves out files the config ignores", () => {
  const files = { "index.html": page("x"), "originals/raw.png": png(10, 10, 900 * KB) };
  assert.equal(findingsFor(files, "assets/large-image").length, 1);
  assert.deepEqual(findingsFor(files, "assets/large-image", { ignore: ["originals/**"] }), []);
});

test("large-stylesheet and large-script report code files over their budgets", () => {
  const files = {
    "index.html": page("x"),
    "app.css": `a{color:red}${" ".repeat(210 * KB)}`,
    "ok.css": "a{color:red}",
    "bundle.js": `//${"x".repeat(520 * KB)}`,
    "module.mjs": `//${"x".repeat(10 * KB)}`,
  };
  assert.deepEqual(findingsFor(files, "assets/large-stylesheet").map((f) => [f.file, f.message.split(".")[0]]), [["app.css", "Stylesheet is 210 KB, over the 200 KB budget"]]);
  assert.deepEqual(findingsFor(files, "assets/large-script").map((f) => f.file), ["bundle.js"]);
  assert.deepEqual(findingsFor(files, "assets/large-script", { rules: { "assets/large-script": { maxKilobytes: 5 } } }).map((f) => f.file), ["bundle.js", "module.mjs"]);
});

test("formats sizes over a megabyte in megabytes", () => {
  const files = { "index.html": page("x"), "poster.png": png(10, 10, 3 * KB * KB) };
  assert.match(findingsFor(files, "assets/large-image")[0].message, /^Image is 3\.0 MB/);
});

test("duplicate-file reports each group of identical files once, at its first path", () => {
  const logo = png(200, 100, 4 * KB);
  const files = {
    "index.html": page("x"),
    "img/logo.png": logo,
    "assets/logo.png": logo,
    "blog/post/logo.png": logo,
    "img/other.png": png(201, 100, 4 * KB),
    "a.js": `//${"a".repeat(2 * KB)}`,
    "b.js": `//${"a".repeat(2 * KB)}`,
  };
  const findings = findingsFor(files, "assets/duplicate-file");
  assert.deepEqual(findings.map((finding) => finding.file), ["a.js", "assets/logo.png"]);
  assert.match(findings[1].message, /^Same content \(4 KB\) is also published as blog\/post\/logo\.png, img\/logo\.png\./);
});

test("duplicate-file skips small files, fixed-path icons, pages and text files", () => {
  const icon = png(32, 32, 4 * KB);
  const text = "y".repeat(4 * KB);
  const files = {
    "index.html": page("same"),
    "copy.html": page("same"),
    "favicon.ico": icon,
    "icons/favicon.ico": icon,
    "tiny-a.svg": svg('viewBox="0 0 1 1"'),
    "tiny-b.svg": svg('viewBox="0 0 1 1"'),
    "a.txt": text,
    "b.txt": text,
  };
  assert.deepEqual(findingsFor(files, "assets/duplicate-file"), []);
  const strict = findingsFor(files, "assets/duplicate-file", { rules: { "assets/duplicate-file": { minKilobytes: 0 } } });
  assert.deepEqual(strict.map((finding) => finding.file), ["tiny-a.svg"]);
});

test("duplicate-file names at most five of the other copies", () => {
  const files = { "index.html": page("x") };
  for (let i = 0; i < 8; i += 1) files[`copy-${i}.css`] = `a{}${" ".repeat(2 * KB)}`;
  const [finding] = findingsFor(files, "assets/duplicate-file");
  assert.match(finding.message, /copy-5\.css and 2 more\./);
});

test("img-missing-dimensions reports images with neither or only one of width and height", () => {
  const body = '<img src="/a.png" alt="a"><img src="/b.png" alt="b" width="10"><img src="/c.png" alt="c" height="10"><img srcset="/d.png 2x" alt="d">';
  const findings = findingsFor({ "index.html": page(body) }, "assets/img-missing-dimensions");
  assert.deepEqual(messages(findings).map((message) => message.split(",")[0]), [
    "Image /a.png has no width and height attributes",
    "Image /b.png has a width but no height attribute",
    "Image /c.png has a height but no width attribute",
    "Image /d.png has no width and height attributes",
  ]);
});

test("img-missing-dimensions is quiet when attributes or CSS give the image its box", () => {
  const css = ".ratio{aspect-ratio:16/9;width:100%} .fixed{width:120px;height:80px} .cover{position:absolute;inset:0} @media (min-width:768px){.wide{aspect-ratio:2}}";
  const body = [
    '<img src="/a.png" alt="" width="10" height="10">',
    '<img src="/a.png" alt="" class="ratio">',
    '<img src="/a.png" alt="" class="fixed">',
    '<img src="/a.png" alt="" class="cover">',
    '<img src="/a.png" alt="" class="wide">',
    '<img src="/a.png" alt="" width="10" style="height:10px">',
    '<img src="/a.png" alt="" hidden>',
    '<div style="display:none"><img src="/a.png" alt=""></div>',
    '<noscript><img src="/a.png" alt=""></noscript>',
    '<template><img src="/a.png" alt=""></template>',
    '<img alt="no source at all">',
  ].join("");
  const files = { "index.html": page(body, '<link rel="stylesheet" href="/s.css">'), "s.css": css, "a.png": png(10, 10) };
  assert.deepEqual(findingsFor(files, "assets/img-missing-dimensions"), []);
});

test("img-missing-dimensions still reports when CSS sets only one side or sets it to auto", () => {
  const files = { "index.html": page('<img src="/a.png" alt="" class="w">', '<link rel="stylesheet" href="/s.css">'), "s.css": ".w{width:100%;height:auto}" };
  assert.equal(findingsFor(files, "assets/img-missing-dimensions").length, 1);
});

test("srcsetCandidates reads densities and widths, and skips nonsense descriptors", () => {
  assert.deepEqual(srcsetCandidates("a.png, b.png 2x, c.png 1.5x"), [{ url: "a.png", density: 1 }, { url: "b.png", density: 2 }, { url: "c.png", density: 1.5 }]);
  assert.deepEqual(srcsetCandidates("s.jpg 480w,m.jpg 960w"), [{ url: "s.jpg", width: 480 }, { url: "m.jpg", width: 960 }]);
  assert.deepEqual(srcsetCandidates("a.png 0x, b.png banana, data:image/png;base64,AA== 1x"), [{ url: "data:image/png;base64,AA==", density: 1 }]);
});

const BIG = 20 * KB;

test("oversized-image reports an image shown far smaller than it is", () => {
  const files = { "index.html": page('<img src="/photo.jpg" alt="" width="300" height="200">'), "photo.jpg": jpeg(2400, 1600, BIG) };
  const [finding] = findingsFor(files, "assets/oversized-image");
  assert.equal(finding.message, "/photo.jpg is 2400x1600 but shown at 300 pixels wide, 8.0 times what the screen needs. Serve a smaller file, or add smaller srcset candidates");
});

test("oversized-image allows the ratio, which leaves room for high density screens", () => {
  const files = { "index.html": page('<img src="/photo.jpg" alt="" width="400" height="300">'), "photo.jpg": jpeg(1200, 900, BIG) };
  assert.deepEqual(findingsFor(files, "assets/oversized-image"), []);
  const strict = findingsFor(files, "assets/oversized-image", { rules: { "assets/oversized-image": { ratio: 2 } } });
  assert.equal(strict.length, 1);
});

test("oversized-image judges density candidates by the screen each one is for", () => {
  const head = "";
  const ok = page('<img src="/a1.jpg" srcset="/a1.jpg 1x, /a2.jpg 2x" alt="" width="500" height="500">', head);
  const files = { "index.html": ok, "a1.jpg": jpeg(500, 500, BIG), "a2.jpg": jpeg(1000, 1000, BIG) };
  assert.deepEqual(findingsFor(files, "assets/oversized-image"), []);
  const bad = page('<img src="/a1.jpg" srcset="/a1.jpg 1x, /huge.jpg 2x" alt="" width="200" height="200">', head);
  const findings = findingsFor({ ...files, "index.html": bad, "huge.jpg": jpeg(4000, 4000, BIG) }, "assets/oversized-image");
  assert.match(findings[0].message, /^\/huge\.jpg, the 2x candidate, is 4000x4000 but shown at 200 pixels wide, 10\.0 times/);
});

test("oversized-image with width candidates reports only when even the smallest is too big", () => {
  const files = {
    "small.jpg": jpeg(480, 320, BIG),
    "large.jpg": jpeg(1920, 1280, BIG),
    "index.html": page('<img src="/large.jpg" srcset="/large.jpg 1920w, /small.jpg 480w" sizes="300px" alt="" width="300" height="200">'),
  };
  assert.deepEqual(findingsFor(files, "assets/oversized-image"), []);
  files["index.html"] = page('<img srcset="/large.jpg 1920w" alt="" width="300" height="200">');
  assert.match(findingsFor(files, "assets/oversized-image")[0].message, /^The smallest srcset candidate, \/large\.jpg, is 1920x1280/);
});

test("oversized-image reads the display size from CSS pixels and skips what it cannot measure", () => {
  const files = {
    "s.css": ".thumb{width:100px;height:100px} .fluid{width:100%}",
    "photo.jpg": jpeg(2000, 2000, BIG),
    "tiny.png": png(1000, 1000),
    "logo.svg": svg('viewBox="0 0 2000 2000"'),
    "index.html": page(
      '<img src="/photo.jpg" alt="" class="thumb"><img src="/photo.jpg" alt="" class="fluid"><img src="/tiny.png" alt="" width="10" height="10"><img src="/logo.svg" alt="" width="20" height="20"><img src="https://cdn.example.org/x.jpg" alt="" width="5" height="5">',
      '<link rel="stylesheet" href="/s.css">',
    ),
  };
  const findings = findingsFor(files, "assets/oversized-image");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /shown at 100 pixels wide, 20\.0 times/);
});

test("page-weight adds up the page and everything it loads from the build, each once", () => {
  const head = '<link rel="stylesheet" href="/a.css"><script src="/app.js" defer></script><script src="/app.js" defer></script>';
  const body = '<img src="/hero.jpg" alt="" width="1" height="1"><img src="/hero.jpg" alt="" width="1" height="1"><img srcset="/s1.jpg 1x, /s2.jpg 2x" alt="" width="1" height="1">';
  const files = {
    "index.html": page(body, head),
    "a.css": `@import "b.css";@font-face{font-family:F;font-display:swap;src:url(f.woff2) format("woff2"),url(f.woff) format("woff")}${" ".repeat(100 * KB)}`,
    "b.css": `a{}${" ".repeat(100 * KB)}`,
    "f.woff2": Buffer.alloc(200 * KB),
    "f.woff": Buffer.alloc(900 * KB),
    "app.js": `//${"x".repeat(1200 * KB)}`,
    "hero.jpg": jpeg(10, 10, 1500 * KB),
    "s1.jpg": jpeg(10, 10, 300 * KB),
    "s2.jpg": jpeg(10, 10, 900 * KB),
    "unused.jpg": jpeg(10, 10, 5000 * KB),
  };
  const [finding] = findingsFor(files, "assets/page-weight");
  assert.equal(finding.file, "index.html");
  assert.match(finding.message, /^Page loads 3\.3 MB from the build \(HTML 1 KB, CSS 200 KB, scripts 1\.2 MB, fonts 200 KB, images 1\.8 MB\), over the 3072 KB budget$/);
  assert.deepEqual(findingsFor(files, "assets/page-weight", { rules: { "assets/page-weight": { maxKilobytes: 4000 } } }), []);
});

test("page-weight is quiet for an ordinary page", () => {
  const files = { "index.html": page('<img src="/a.png" alt="" width="1" height="1">', '<link rel="stylesheet" href="/s.css">'), "s.css": "a{}", "a.png": png(1, 1, 50 * KB) };
  assert.deepEqual(findingsFor(files, "assets/page-weight"), []);
});

test("render-blocking-script reports classic scripts in head without async or defer", () => {
  const head = [
    '<script src="/blocking.js"></script>',
    '<script src="https://cdn.example.org/lib.js" type="text/javascript"></script>',
    '<script src="/deferred.js" defer></script>',
    '<script src="/async.js" async></script>',
    '<script src="/module.js" type="module"></script>',
    '<script src="/legacy.js" nomodule></script>',
    '<script type="application/ld+json">{}</script>',
    "<script>window.inline = 1</script>",
    '<script src="/template.js" type="text/x-template"></script>',
  ].join("");
  const findings = findingsFor({ "index.html": page('<script src="/body.js"></script>', head) }, "assets/render-blocking-script");
  assert.deepEqual(messages(findings).map((message) => message.split(" in ")[0]), ["Script /blocking.js", "Script https://cdn.example.org/lib.js"]);
});

test("render-blocking-script ignores scripts that a page without a head puts first", () => {
  const html = '<!doctype html><html lang="en"><title>x</title><script src="/a.js"></script><p>x</p></html>';
  assert.deepEqual(findingsFor({ "index.html": html }, "assets/render-blocking-script"), []);
});

test("font-display reports @font-face rules without it, in files and style blocks", () => {
  const files = {
    "index.html": page("x", '<link rel="stylesheet" href="/f.css"><style>@font-face{font-family:"Inline Face";src:url(/i.woff2)}</style>'),
    "f.css": '@font-face{font-family:"Body";src:url(b.woff2) format("woff2")}\n@font-face{font-family:"Ok";font-display:optional;src:url(o.woff2)}\n@font-face{font-family:"Icons";font-display:block;src:url(i.woff2)}',
  };
  const findings = findingsFor(files, "assets/font-display");
  assert.deepEqual(findings.map((finding) => [finding.file, finding.line, finding.message.split(" has ")[0]]), [
    ["f.css", 1, '@font-face for "Body"'],
    ["index.html", 1, '@font-face for "Inline Face"'],
  ]);
});

test("font-display is quiet for font rules that only name a local font", () => {
  const files = { "index.html": page("x", '<style>@font-face{font-family:Sys}body{font-display:swap}</style>') };
  assert.deepEqual(findingsFor(files, "assets/font-display"), []);
});

test("mixed-content reports http: subresources on an HTTPS site", () => {
  const head = '<link rel="stylesheet" href="http://cdn.example.org/a.css"><script src="http://cdn.example.org/a.js" defer></script><link rel="canonical" href="http://www.example.com/">';
  const body = '<img src="http://img.example.org/a.png" srcset="https://img.example.org/b.png 1x, http://img.example.org/c.png 2x" alt="" width="1" height="1"><a href="http://www.example.org/">a plain link</a><iframe src="http://localhost:3000/"></iframe><div style="background:url(http://img.example.org/bg.png)"></div>';
  const files = { "index.html": page(body, head), "s.css": "@import url(http://cdn.example.org/x.css);" };
  const config = { site: { url: "https://www.example.com/" } };
  const findings = findingsFor(files, "assets/mixed-content", config);
  assert.deepEqual(findings.map((finding) => finding.message.split(" over ")[0]), [
    "Loads http://cdn.example.org/a.css",
    "Loads http://cdn.example.org/a.js",
    "Loads http://img.example.org/a.png",
    "Loads http://img.example.org/c.png",
    "CSS loads http://img.example.org/bg.png",
    "CSS loads http://cdn.example.org/x.css",
  ]);
});

test("mixed-content stays quiet on an HTTP site and when nothing says how the site is served", () => {
  const files = { "index.html": page('<img src="http://img.example.org/a.png" alt="" width="1" height="1">') };
  assert.deepEqual(findingsFor(files, "assets/mixed-content", { site: { url: "http://www.example.com/" } }), []);
  assert.deepEqual(findingsFor(files, "assets/mixed-content"), []);
});

test("mixed-content learns HTTPS from the sitemap when no URL is configured", () => {
  const files = {
    "index.html": page('<img src="http://img.example.org/a.png" alt="" width="1" height="1">'),
    "sitemap.xml": '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.example.com/</loc></url></urlset>',
  };
  assert.equal(findingsFor(files, "assets/mixed-content").length, 1);
});

test("asset rules are quiet on the clean fixture site", () => {
  withFixtureSite("clean-site", (root) => {
    const result = audit(root, { rules: { "*": "off", "assets/*": "error" } });
    assert.deepEqual(result.findings, []);
  });
});

test("asset rules run end to end with the default settings", () => {
  const files = {
    "index.html": page('<img src="/a.png" alt="">', '<script src="/a.js"></script>'),
    "a.js": "1",
    "a.png": png(10, 10),
  };
  withSite(files, (root) => {
    const result = audit(root, { rules: { "*": "off", "assets/*": "warning" } });
    assert.deepEqual(result.findings.map((finding) => finding.rule), ["assets/render-blocking-script", "assets/img-missing-dimensions"]);
    assert.equal(result.complete, true);
  });
});
