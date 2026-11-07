import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { makeMatcher } from "../src/site/glob.js";
import { readImageSize } from "../src/site/images.js";
import { matchRedirect, parseRedirects } from "../src/site/redirects.js";
import { checkAccess, namesCrawler, parseRobots } from "../src/site/robots.js";
import { parseSitemapXml } from "../src/site/sitemap.js";
import { findingsFor, page, withSite } from "./helpers.js";

function png(width, height) {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "latin1");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function jpegFrame(marker, width, height) {
  return [0xff, marker, 0x00, 0x0b, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00];
}

const SOI = [0xff, 0xd8];

test("reads PNG dimensions", () => {
  assert.deepEqual(readImageSize(png(1200, 630)), { format: "png", width: 1200, height: 630 });
});

test("reads sequential and progressive JPEG dimensions", () => {
  assert.deepEqual(readImageSize(Buffer.from([...SOI, ...jpegFrame(0xc0, 1200, 630)])), { format: "jpeg", width: 1200, height: 630 });
  assert.deepEqual(readImageSize(Buffer.from([...SOI, ...jpegFrame(0xc2, 800, 600)])), { format: "jpeg", width: 800, height: 600 });
});

test("skips metadata in a JPEG, including a thumbnail frame hidden inside it", () => {
  const thumbnail = jpegFrame(0xc0, 160, 120);
  const app1 = [0xff, 0xe1, 0x00, thumbnail.length + 2, ...thumbnail];
  assert.deepEqual(readImageSize(Buffer.from([...SOI, ...app1, ...jpegFrame(0xc0, 1200, 630)])), { format: "jpeg", width: 1200, height: 630 });
});

test("skips Huffman tables, which share the frame header marker range", () => {
  const dht = [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00];
  assert.equal(readImageSize(Buffer.from([...SOI, ...dht, ...jpegFrame(0xc0, 10, 20)])).width, 10);
});

test("accepts fill bytes before a JPEG marker", () => {
  assert.equal(readImageSize(Buffer.from([...SOI, 0xff, 0xff, ...jpegFrame(0xc0, 10, 20)])).height, 20);
});

test("truncated and foreign files give null, not a crash", () => {
  assert.equal(readImageSize(Buffer.from([])), null);
  assert.equal(readImageSize(Buffer.from("RIFF....WEBPVP8 ")), null);
  assert.equal(readImageSize(png(1, 1).subarray(0, 20)), null);
  assert.equal(readImageSize(Buffer.from([...SOI, 0xff, 0xe0, 0x00])), null);
  assert.equal(readImageSize(Buffer.from([...SOI, 0xff, 0xc0, 0x00, 0x0b, 0x08])), null);
  assert.equal(readImageSize(Buffer.from([...SOI, 0xff, 0xe0, 0x00, 0x00])), null);
  assert.equal(readImageSize(Buffer.from([...SOI, 0xff, 0xd9])), null);
});

test("a crawler obeys its own group over the wildcard group", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n");
  assert.equal(checkAccess(robots, "GPTBot", "/").allowed, true);
  assert.equal(checkAccess(robots, "OtherBot", "/").allowed, false);
});

test("agent names match whatever their case", () => {
  const robots = parseRobots("user-agent: gptbot\ndisallow: /\n");
  assert.equal(checkAccess(robots, "GPTBot", "/").allowed, false);
  assert.equal(namesCrawler(robots, "GPTBot"), true);
  assert.equal(namesCrawler(robots, "CCBot"), false);
});

test("a name is not matched by another that only contains it", () => {
  const robots = parseRobots("User-agent: Applebot\nDisallow: /\n");
  assert.equal(checkAccess(robots, "Applebot-Extended", "/").allowed, true);
});

test("consecutive agent lines share a group, and blank lines do not end it", () => {
  const robots = parseRobots("User-agent: A\nUser-agent: B\n\nDisallow: /x\n");
  assert.equal(robots.groups.length, 1);
  assert.equal(checkAccess(robots, "B", "/x/y").allowed, false);
});

test("separate groups for one agent combine", () => {
  const robots = parseRobots("User-agent: A\nDisallow: /a\n\nUser-agent: B\nDisallow: /b\n\nUser-agent: A\nDisallow: /c\n");
  assert.equal(checkAccess(robots, "A", "/c").allowed, false);
  assert.equal(checkAccess(robots, "A", "/a").allowed, false);
  assert.equal(checkAccess(robots, "A", "/b").allowed, true);
});

test("the longest matching rule decides, and allow wins a tie", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /\nAllow: /public\nDisallow: /public/secret\nAllow: /tie\nDisallow: /tie\n");
  assert.equal(checkAccess(robots, "X", "/").allowed, false);
  assert.equal(checkAccess(robots, "X", "/public/page").allowed, true);
  assert.equal(checkAccess(robots, "X", "/public/secret/a").allowed, false);
  assert.equal(checkAccess(robots, "X", "/tie").allowed, true);
});

test("wildcards and end anchors work in paths", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /a*/b\n");
  assert.equal(checkAccess(robots, "X", "/x/report.pdf").allowed, false);
  assert.equal(checkAccess(robots, "X", "/x/report.pdf?x").allowed, true);
  assert.equal(checkAccess(robots, "X", "/axx/b").allowed, false);
});

test("an empty Disallow allows everything", () => {
  assert.equal(checkAccess(parseRobots("User-agent: *\nDisallow:\n"), "X", "/").allowed, true);
});

test("Disallow: /* blocks the home page too", () => {
  assert.equal(checkAccess(parseRobots("User-agent: *\nDisallow: /*\n"), "X", "/").allowed, false);
});

test("ignores comments, CRLF line endings and unknown directives", () => {
  const robots = parseRobots("# top\r\nUser-agent: X # note\r\nCrawl-delay: 5\r\nDisallow: /a # note\r\nSitemap: https://e.example/s.xml\r\n");
  assert.equal(checkAccess(robots, "X", "/a").allowed, false);
  assert.deepEqual(robots.sitemaps.map((s) => s.url), ["https://e.example/s.xml"]);
});

test("a Sitemap line in the middle of a group does not end the group", () => {
  const robots = parseRobots("User-agent: X\nSitemap: https://e.example/s.xml\nDisallow: /\n");
  assert.equal(checkAccess(robots, "X", "/").allowed, false);
});

test("a rule before any User-agent line is ignored", () => {
  assert.equal(checkAccess(parseRobots("Disallow: /\n"), "X", "/").allowed, true);
});

test("parses sitemaps and index files, skipping comments and honoring CDATA and references", () => {
  const set = parseSitemapXml(`<urlset><!-- <url><loc>https://e.example/no</loc></url> -->
    <url><loc> https://e.example/a?x=1&amp;y=2 </loc><image:image><image:loc>https://e.example/i.png</image:loc></image:image></url>
    <url><loc><![CDATA[https://e.example/b]]></loc></url></urlset>`);
  assert.equal(set.kind, "urlset");
  assert.deepEqual(set.locs.map((l) => l.url), ["https://e.example/a?x=1&y=2", "https://e.example/b"]);
  assert.equal(parseSitemapXml("<sitemapindex><sitemap><loc>x</loc></sitemap></sitemapindex>").kind, "index");
  assert.equal(parseSitemapXml("<html></html>"), null);
});

test("follows a sitemap index to its children, wherever robots.txt says it lives", () => {
  const files = {
    "robots.txt": "User-agent: *\nAllow: /\nSitemap: https://www.example.com/maps/index.xml\n",
    "maps/index.xml": "<sitemapindex><sitemap><loc>https://www.example.com/maps/one.xml</loc></sitemap></sitemapindex>",
    "maps/one.xml": "<urlset><url><loc>https://www.example.com/</loc></url><url><loc>https://www.example.com/gone</loc></url></urlset>",
    "index.html": page("home"),
  };
  const found = findingsFor(files, "foundation/*");
  const stale = found.filter((f) => f.rule === "foundation/sitemap-stale-url");
  assert.equal(stale.length, 1);
  assert.equal(stale[0].file, "maps/one.xml");
  assert.equal(stale[0].line, 1);
});

test("reads a gzip compressed sitemap", () => {
  const files = {
    "sitemap.xml.gz": gzipSync("<urlset><url><loc>https://www.example.com/gone</loc></url></urlset>"),
    "index.html": page("home"),
  };
  const stale = findingsFor(files, "foundation/sitemap-stale-url");
  assert.deepEqual(stale.map((f) => f.file), ["sitemap.xml.gz"]);
  assert.equal(stale[0].line, null);
});

test("reports a bad gzip file, an empty sitemap, a wrong root, a dead index entry and a relative URL", () => {
  const cases = [
    [{ "sitemap.xml.gz": "not gzip" }, "could not be decompressed"],
    [{ "sitemap.xml": "<urlset></urlset>" }, "lists no URLs"],
    [{ "sitemap.xml": "<html></html>" }, "no <urlset>"],
    [{ "sitemap.xml": "<sitemapindex><sitemap><loc>https://e.example/none.xml</loc></sitemap></sitemapindex>" }, "not in the build"],
    [{ "sitemap.xml": "<urlset><url><loc>/about/</loc></url></urlset>" }, "not an absolute"],
  ];
  for (const [files, text] of cases) {
    const found = findingsFor({ ...files, "index.html": page("x") }, "foundation/sitemap-invalid");
    assert.equal(found.length, 1, text);
    assert.ok(found[0].message.includes(text), found[0].message);
  }
});

test("infers the base path from the sitemap when it is not a folder in the build", () => {
  const files = {
    "sitemap.xml": "<urlset><url><loc>https://www.example.com/docs/</loc></url><url><loc>https://www.example.com/docs/about/</loc></url></urlset>",
    "index.html": page('<a href="/docs/about/">About</a><img src="/docs/logo.svg" alt="">'),
    "about/index.html": page('<a href="/docs/">Home</a><a href="/other-app/">Another app</a>'),
    "logo.svg": "<svg/>",
  };
  const result = withSiteAudit(files);
  assert.equal(result.site.basePath, "/docs");
  assert.deepEqual(result.findings, []);
});

test("a sitemap with one stale URL is not mistaken for a base path", () => {
  const files = { "sitemap.xml": "<urlset><url><loc>https://www.example.com/gone</loc></url></urlset>", "index.html": page("x") };
  const result = withSiteAudit(files);
  assert.equal(result.site.basePath, "/");
  assert.deepEqual(result.findings.map((f) => f.rule), ["foundation/sitemap-stale-url"]);
});

test("does not infer a base path when the leading folder really exists", () => {
  const files = {
    "sitemap.xml": "<urlset><url><loc>https://www.example.com/en/</loc></url><url><loc>https://www.example.com/en/about/</loc></url></urlset>",
    "en/index.html": page('<a href="/en/about/">About</a>'),
    "en/about/index.html": page('<a href="/en/">Home</a>'),
  };
  const result = withSiteAudit(files);
  assert.equal(result.site.basePath, "/");
  assert.deepEqual(result.findings, []);
});

function withSiteAudit(files) {
  const config = { rules: { "*": "off", "links/*": "error", "foundation/sitemap-stale-url": "error" } };
  return withSite(files, (root) => audit(root, config));
}

test("parses _redirects with exact paths, splats and placeholders", () => {
  const rules = parseRedirects("# c\n/old /new 301\n/blog/* /news/:splat\n/u/:id/x /v 302\nnot-a-path /x\n/half\n");
  assert.equal(rules.length, 3);
  assert.ok(matchRedirect(rules, "/old"));
  assert.ok(matchRedirect(rules, "/old/"));
  assert.ok(matchRedirect(rules, "/blog/a/b"));
  assert.ok(matchRedirect(rules, "/blog"));
  assert.ok(matchRedirect(rules, "/u/7/x"));
  assert.equal(matchRedirect(rules, "/oldest"), null);
  assert.equal(matchRedirect(rules, "/u/7/8/x"), null);
});

test("globs treat one star and two stars differently", () => {
  const match = makeMatcher(["admin/**", "*.tmp.html", "a/*/c.html", "**/draft.html", "q?.html"]);
  assert.ok(match("admin/x/y.html"));
  assert.ok(match("z.tmp.html"));
  assert.ok(!match("deep/z.tmp.html"));
  assert.ok(match("a/b/c.html"));
  assert.ok(!match("a/b/b/c.html"));
  assert.ok(match("draft.html"));
  assert.ok(match("x/y/draft.html"));
  assert.ok(match("q1.html"));
  assert.ok(!match("q12.html"));
});

test("globs escape regular expression characters", () => {
  const match = makeMatcher(["a+b(1).html"]);
  assert.ok(match("a+b(1).html"));
  assert.ok(!match("aab(1).html"));
});
