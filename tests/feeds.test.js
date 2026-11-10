// Feed and web app manifest rules, and the XML, date and color readers under them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { isCssColor } from "../src/assets/css-color.js";
import { rfc3339Problem, rfc822Problem } from "../src/assets/dates.js";
import { parseXml } from "../src/assets/xml.js";
import { findingsFor, page, withFixtureSite } from "./helpers.js";
import { ico, png, svg } from "./image-bytes.js";

const messages = (findings) => findings.map((finding) => finding.message);
// A fixed base path, since a missing file that every page links would otherwise read as one.
const SITE = { site: { url: "https://www.example.com/", basePath: "/" } };
const RSS_LINK = '<link rel="alternate" type="application/rss+xml" href="/rss.xml" title="Posts">';
const ATOM_LINK = '<link rel="alternate" type="application/atom+xml" href="/atom.xml">';

function rss({ channel = "", items = [{}], attributes = "" } = {}) {
  const itemXml = items.map(({ title = "First post", link = "https://www.example.com/blog/first/", date = "Wed, 02 Oct 2002 13:00:00 GMT", extra = "" }) =>
    `<item>${title === null ? "" : `<title>${title}</title>`}${link === null ? "" : `<link>${link}</link>`}${date === null ? "" : `<pubDate>${date}</pubDate>`}${extra}</item>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"${attributes}>
<channel>
${channel || "<title>Example Bakery</title><link>https://www.example.com/</link><description>News</description>"}
<atom:link href="https://www.example.com/rss.xml" rel="self" type="application/rss+xml"/>
${itemXml}
</channel>
</rss>`;
}

function atom({ feed = "", entries = [{}] } = {}) {
  const entryXml = entries.map(({ id = "tag:example.com,2002:1", title = "First", updated = "2002-10-02T13:00:00Z", link = '<link href="/blog/first/"/>', extra = "" }) =>
    `<entry>${id === null ? "" : `<id>${id}</id>`}${title === null ? "" : `<title>${title}</title>`}${updated === null ? "" : `<updated>${updated}</updated>`}${link}${extra}</entry>`).join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${feed || "<id>tag:example.com,2002:feed</id><title>Example Bakery</title><updated>2002-10-02T13:00:00Z</updated><author><name>Jane Doe</name></author>"}
<link rel="self" href="https://www.example.com/atom.xml"/>
${entryXml}
</feed>`;
}

const pages = (head = RSS_LINK) => ({
  "index.html": page("Home", head),
  "blog/first/index.html": page("First", head),
});

test("parseXml reads elements, attributes, text, CDATA and namespaces", () => {
  const { root, error } = parseXml('<?xml version="1.0"?><!-- note --><a xmlns="urn:x" xmlns:p="urn:p" k=\'v &amp; w\'><p:b>one &lt; two &#233; &#x41;</p:b><![CDATA[<raw> & stuff]]></a>');
  assert.equal(error, null);
  assert.equal(root.local, "a");
  assert.equal(root.ns, "urn:x");
  assert.equal(root.attrs.get("k"), "v & w");
  assert.equal(root.children[0].ns, "urn:p");
  assert.equal(root.children[0].text, "one < two \u00e9 A");
  assert.equal(root.text, "<raw> & stuff");
});

test("parseXml reports where a document stops being well formed", () => {
  const cases = {
    "<a><b></a>": "closes </a> where <b> is still open",
    "<a>": "never closes <a>",
    "<a/><b/>": "has a second root element <b>",
    "<a>&nbsp;</a>": "uses &nbsp;, which XML does not define, write &#160; instead",
    "<a>fish & chips</a>": "has a bare & that does not start a reference: write &amp; instead",
    '<a x="1" x="2"/>': "repeats the attribute x in <a>",
    "<a x=1/>": "has an unquoted value for x in <a>",
    "text<a/>": "has text outside the root element",
    " <?xml version='1.0'?><a/>": "has an XML declaration that is not at the very start",
    "<a><!-- open</a>": "has a comment that is never closed",
    "<a>1 < 2</a>": "has a < that does not start a tag: write &lt; instead",
    "": "has no root element",
    "<a>&#0;</a>": "has &#0;, which is not a character XML allows",
  };
  for (const [xml, message] of Object.entries(cases)) {
    assert.equal(parseXml(xml).error?.message, message, xml);
  }
  assert.equal(parseXml("<a>\n<b>\n</a>").error.offset, 8);
});

test("parseXml accepts entities a DOCTYPE declares, and a byte order mark", () => {
  assert.equal(parseXml('<!DOCTYPE a [<!ENTITY nbsp "&#160;">]><a>&nbsp;</a>').error, null);
  assert.equal(parseXml("\ufeff<?xml version='1.0'?><a/>").error, null);
});

test("rfc822Problem accepts RSS dates and explains bad ones", () => {
  for (const good of ["Wed, 02 Oct 2002 13:00:00 GMT", "2 Oct 2002 13:00 +0200", "Wed, 02 Oct 02 13:00:00 EST", "Sat, 29 Feb 2020 00:00:00 UTC", "Mon, 06 Jan 2025 08:30:00 -0700"]) {
    assert.equal(rfc822Problem(good), null, good);
  }
  assert.match(rfc822Problem("2002-10-02T13:00:00Z"), /^is not an RFC 822 date/);
  assert.equal(rfc822Problem("Wed, 31 Apr 2002 13:00:00 GMT"), "has no such day in that month");
  assert.equal(rfc822Problem("Fri, 29 Feb 2019 00:00:00 GMT"), "has no such day in that month");
  assert.equal(rfc822Problem("Wed, 02 Oct 2002 25:00:00 GMT"), "has a time that does not exist");
  assert.equal(rfc822Problem("Thu, 02 Oct 2002 13:00:00 GMT"), "says Thursday, but that date is a Wednesday");
  assert.match(rfc822Problem("Wed, 02 Okt 2002 13:00:00 GMT"), /Okt is not a month/);
});

test("rfc3339Problem accepts Atom dates and explains bad ones", () => {
  for (const good of ["2002-10-02T13:00:00Z", "2002-10-02T13:00:00.123+02:00", "2020-02-29T23:59:60-07:00"]) {
    assert.equal(rfc3339Problem(good), null, good);
  }
  assert.match(rfc3339Problem("Wed, 02 Oct 2002 13:00:00 GMT"), /^is not an RFC 3339 date/);
  assert.match(rfc3339Problem("2002-10-02 13:00:00z"), /^must separate date and time with an upper case T/);
  assert.equal(rfc3339Problem("2002-13-02T13:00:00Z"), "has no such month");
  assert.equal(rfc3339Problem("2002-10-02T13:00:00+24:00"), "has a time zone offset that does not exist");
  assert.match(rfc3339Problem("2002-10-02"), /^is not an RFC 3339 date/);
});

test("isCssColor accepts the color syntaxes browsers do", () => {
  for (const good of ["#123", "#1234", "#112233", "#11223344", "rebeccapurple", "Transparent", "rgb(10 20 30)", "rgba(10, 20, 30, 0.5)", "hsl(210deg 40% 50% / 50%)", "oklch(0.7 0.1 250)", "color(display-p3 1 0.5 0)", "color-mix(in srgb, red, blue)", "rgb(from red r g b)", "hwb(120 10% 20%)"]) {
    assert.equal(isCssColor(good), true, good);
  }
  for (const bad of ["#12345", "#ggg", "blu", "", "rgb(1, 2)", "rgb(1 2 3 4 5)", "color(nonsense 1 2 3)", "hsl(a b c)", "rgb(1 2 3", 42, "var(--brand)"]) {
    assert.equal(isCssColor(bad), false, String(bad));
  }
});

test("a clean RSS feed and a clean Atom feed report nothing", () => {
  const files = { ...pages(`${RSS_LINK}${ATOM_LINK}`), "rss.xml": rss(), "atom.xml": atom() };
  assert.deepEqual(findingsFor(files, "feeds/*", SITE), []);
});

test("feeds/missing reports a feed that pages announce but the build lacks, once", () => {
  const findings = findingsFor(pages(), "feeds/missing", SITE);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].message, "Page announces the feed /rss.xml, which is not in the build. Feed readers that follow it get nothing");
  const external = { "index.html": page("x", '<link rel="alternate" type="application/rss+xml" href="https://feeds.example.org/x">') };
  assert.deepEqual(findingsFor(external, "feeds/missing", SITE), []);
});

test("feeds/invalid reports a feed that is not well-formed XML, with its line", () => {
  const files = { ...pages(), "rss.xml": rss({ items: [{ title: "Fish &amp; chips" }, { title: "Bread &nbsp; butter" }] }) };
  const [finding] = findingsFor(files, "feeds/invalid", SITE);
  assert.equal(finding.file, "rss.xml");
  assert.equal(finding.line, 7);
  assert.match(finding.message, /^Feed is not well-formed XML, so feed readers reject it: it uses &nbsp;/);
});

test("feeds/invalid reports a linked file that is not a feed, and Atom outside its namespace", () => {
  const files = { "index.html": page("x", '<link rel="alternate" type="application/rss+xml" href="/feed.xml">'), "feed.xml": "<?xml version='1.0'?><html/>" };
  assert.match(messages(findingsFor(files, "feeds/invalid", SITE))[0], /root element is <html>, not an RSS <rss> or Atom <feed>/);
  const bare = { "index.html": page("x"), "atom.xml": "<feed><title>x</title></feed>" };
  assert.match(messages(findingsFor(bare, "feeds/invalid", SITE))[0], /^Atom <feed> is not in the Atom namespace/);
});

test("feeds/invalid checks feeds at common paths that nobody links, but not other XML there", () => {
  const broken = { "index.html": page("x"), "feed.xml": "<rss version='2.0'><channel></rss>" };
  assert.equal(findingsFor(broken, "feeds/invalid", SITE).length, 1);
  const unrelated = { "index.html": page("x"), "index.xml": "<config><broken></config>" };
  assert.deepEqual(findingsFor(unrelated, "feeds/invalid", SITE), []);
  const rdf = { "index.html": page("x", '<link rel="alternate" type="application/rss+xml" href="/rdf.xml">'), "rdf.xml": '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>' };
  assert.deepEqual(findingsFor(rdf, "feeds/invalid", SITE), []);
});

test("feeds/required-field reports RSS channel fields and items with nothing to show", () => {
  const files = { ...pages(), "rss.xml": rss({ channel: "<title>Example</title>", items: [{}, { title: null }, { title: null }] }) };
  assert.deepEqual(messages(findingsFor(files, "feeds/required-field", SITE)), [
    "RSS <channel> has no <link>, <description>, which RSS 2.0 requires",
    "2 of 3 items have neither a <title> nor a <description>, so readers show them blank",
  ]);
  const empty = { "index.html": page("x"), "rss.xml": "<rss version='2.0'></rss>" };
  assert.match(messages(findingsFor(empty, "feeds/required-field", SITE))[0], /^RSS feed has no <channel> element/);
});

test("feeds/required-field reports Atom feed and entry fields", () => {
  const files = {
    ...pages(ATOM_LINK),
    "atom.xml": atom({ feed: "<title>Example</title>", entries: [{ id: null }, { id: null, link: "" }] }),
  };
  assert.deepEqual(messages(findingsFor(files, "feeds/required-field", SITE)), [
    "Atom <feed> has no <author>, and 2 entries have none of their own. Atom requires one or the other",
    "Atom <feed> has no <id>, <updated>, which Atom requires",
    "All 2 entries have no <id>, which every Atom entry needs",
    "1 of 2 entries has neither <content> nor an alternate <link>, so there is nothing to read",
  ]);
});

test("feeds/required-field accepts an author on every entry instead of on the feed", () => {
  const author = "<author><name>Jane Doe</name></author>";
  const feed = "<id>x</id><title>t</title><updated>2002-10-02T13:00:00Z</updated>";
  const files = { ...pages(ATOM_LINK), "atom.xml": atom({ feed, entries: [{ extra: author }, { extra: `<content>c</content>${author}`, link: "" }] }) };
  assert.deepEqual(findingsFor(files, "feeds/required-field", SITE), []);
});

test("feeds/item-link reports item links to pages that are not built, and relative RSS links", () => {
  const files = {
    ...pages(),
    "rss.xml": rss({ items: [{}, { link: "https://www.example.com/blog/gone/" }, { link: "/blog/first/" }, { link: "https://www.example.org/elsewhere/" }] }),
  };
  assert.deepEqual(messages(findingsFor(files, "feeds/item-link", SITE)), [
    "Feed link https://www.example.com/blog/gone/ leads to no page in the build",
    "RSS <link> /blog/first/ is relative. RSS needs absolute URLs, and readers cannot open this one",
  ]);
});

test("feeds/item-link resolves Atom links against the feed and xml:base", () => {
  const entries = [{}, { link: '<link rel="alternate" href="missing/"/>', extra: "" }, { link: '<link href="first/" xml:base="/blog/"/>' }, { link: '<link rel="enclosure" href="/nope.mp3"/><link href="/blog/first/"/>' }];
  const files = { ...pages(ATOM_LINK), "atom.xml": atom({ entries }) };
  assert.deepEqual(messages(findingsFor(files, "feeds/item-link", SITE)), ["Feed link missing/ leads to no page in the build"]);
});

test("feeds/date reports one finding per date element, with how many are wrong", () => {
  const items = [{ date: "2002-10-02" }, { date: "2002-10-03" }, {}, { date: "Thu, 02 Oct 2002 13:00:00 GMT" }];
  const files = { ...pages(), "rss.xml": rss({ items, channel: "<title>t</title><link>https://www.example.com/</link><description/><lastBuildDate>yesterday</lastBuildDate>" }) };
  assert.deepEqual(messages(findingsFor(files, "feeds/date", SITE)), [
    '<lastBuildDate> "yesterday" is not an RFC 822 date such as "Wed, 02 Oct 2002 13:00:00 GMT"',
    '<pubDate> "2002-10-02" is not an RFC 822 date such as "Wed, 02 Oct 2002 13:00:00 GMT" (3 <pubDate> dates in this feed are invalid)',
  ]);
});

test("feeds/date reads Atom dates as RFC 3339", () => {
  const files = { ...pages(ATOM_LINK), "atom.xml": atom({ entries: [{ updated: "Wed, 02 Oct 2002 13:00:00 GMT" }, { extra: "<published>2002-10-02T13:00:00z</published>" }] }) };
  assert.deepEqual(messages(findingsFor(files, "feeds/date", SITE)).map((message) => message.split(" ").slice(0, 2).join(" ")), ['<updated> "Wed,', '<published> "2002-10-02T13:00:00z"']);
});

test("feeds/self-link reports a self link that points somewhere other than the feed", () => {
  const moved = rss().replace("https://www.example.com/rss.xml", "https://www.example.com/feed.xml");
  assert.deepEqual(messages(findingsFor({ ...pages(), "rss.xml": moved }, "feeds/self-link", SITE)), [
    "Feed's self link https://www.example.com/feed.xml points at /feed.xml, but the feed is at /rss.xml. Readers use it to know where to fetch updates",
  ]);
  const elsewhere = rss().replace("https://www.example.com/rss.xml", "https://feeds.example.org/bakery");
  assert.match(messages(findingsFor({ ...pages(), "rss.xml": elsewhere }, "feeds/self-link", SITE))[0], /points at another host/);
  const relative = { ...pages(ATOM_LINK), "atom.xml": atom().replace("https://www.example.com/atom.xml", "atom.xml") };
  assert.deepEqual(findingsFor(relative, "feeds/self-link", SITE), []);
});

test("feeds/self-link takes the base path into account", () => {
  const files = {
    "index.html": page("x", '<link rel="alternate" type="application/rss+xml" href="/docs/rss.xml">'),
    "blog/first/index.html": page("y"),
    "rss.xml": rss().replace("https://www.example.com/rss.xml", "https://www.example.com/docs/rss.xml").replaceAll("https://www.example.com/blog/", "https://www.example.com/docs/blog/"),
  };
  assert.deepEqual(findingsFor(files, "feeds/*", { site: { url: "https://www.example.com/docs/" } }), []);
});

function manifest(fields = {}) {
  return JSON.stringify({
    name: "Example Bakery",
    short_name: "Bakery",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#2b2622",
    background_color: "oklch(0.98 0.01 80)",
    icons: [
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/mask.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    ...fields,
  }, null, 2);
}

const MANIFEST_LINK = '<link rel="manifest" href="/site.webmanifest">';
const app = (text = manifest(), extra = {}) => ({
  "index.html": page("Home", MANIFEST_LINK),
  "about/index.html": page("About", MANIFEST_LINK),
  "site.webmanifest": text,
  "icons/192.png": png(192, 192),
  "icons/512.png": png(512, 512),
  "icons/mask.png": png(512, 512),
  ...extra,
});

test("a clean web app manifest reports nothing", () => {
  assert.deepEqual(findingsFor(app(), "manifest/*", SITE), []);
});

test("manifest/missing reports a linked manifest that is not in the build, once", () => {
  const files = { "index.html": page("x", MANIFEST_LINK), "b.html": page("y", MANIFEST_LINK) };
  assert.deepEqual(messages(findingsFor(files, "manifest/missing", SITE)), ["Page links the web app manifest /site.webmanifest, which is not in the build"]);
});

test("manifest/invalid reports JSON that does not parse, or that is not an object", () => {
  const [broken] = findingsFor(app('{\n  "name": "x",\n}'), "manifest/invalid", SITE);
  assert.equal(broken.file, "site.webmanifest");
  assert.match(broken.message, /^Web app manifest is not valid JSON, so browsers ignore it: /);
  assert.deepEqual(messages(findingsFor(app("[1, 2]"), "manifest/invalid", SITE)), ["Web app manifest must hold a JSON object, so browsers ignore this one"]);
  assert.deepEqual(findingsFor(app("[1, 2]"), "manifest/name", SITE), []);
});

test("manifest/name reports a manifest with neither name nor short_name", () => {
  assert.equal(findingsFor(app(manifest({ name: undefined, short_name: " " })), "manifest/name", SITE).length, 1);
  assert.deepEqual(findingsFor(app(manifest({ name: undefined })), "manifest/name", SITE), []);
});

test("manifest/icons reports icons that are missing or not the size they declare", () => {
  const icons = [
    { src: "/icons/192.png", sizes: "192x192" },
    { src: "/icons/512.png", sizes: "256x256" },
    { src: "missing.png", sizes: "48x48" },
    { sizes: "16x16" },
    { src: "/favicon.ico", sizes: "16x16 32x32 64x64" },
    { src: "/icons/logo.svg", sizes: "any 512x512" },
    { src: "https://cdn.example.org/icon.png", sizes: "1x1" },
  ];
  const extra = { "favicon.ico": ico([{ width: 16, height: 16 }, { width: 32, height: 32 }]), "icons/logo.svg": svg('viewBox="0 0 10 10"') };
  const findings = findingsFor(app(manifest({ icons }), extra), "manifest/icons", SITE);
  assert.deepEqual(messages(findings), [
    "Icon 4 in the web app manifest has no src",
    "Icon /icons/512.png declares 256x256 but is 512x512, so browsers scale the wrong image",
    "Icon missing.png is not in the build. Icon paths resolve against the manifest's own address",
    "Icon /favicon.ico declares 64x64 but is 16x16, 32x32, so browsers scale the wrong image",
  ]);
  assert.ok(findings.every((finding) => finding.line > 1));
});

test("manifest/icons resolves icon paths against the manifest's folder", () => {
  const files = {
    "index.html": page("x", '<link rel="manifest" href="/app/manifest.json">'),
    "app/manifest.json": JSON.stringify({ name: "x", icons: [{ src: "icon.png", sizes: "64x64" }] }),
    "app/icon.png": png(64, 64),
  };
  assert.deepEqual(findingsFor(files, "manifest/icons", SITE), []);
});

test("manifest/install-icons wants 192 and 512 pixel icons for any purpose in an installable app", () => {
  const icons = [{ src: "/icons/192.png", sizes: "192x192" }, { src: "/icons/mask.png", sizes: "512x512", purpose: "maskable" }];
  assert.deepEqual(messages(findingsFor(app(manifest({ icons })), "manifest/install-icons", SITE)), [
    "Web app manifest declares no 512x512 icon, which browsers want to install the app and show its splash screen",
  ]);
  assert.deepEqual(findingsFor(app(manifest({ icons, display: "browser" })), "manifest/install-icons", SITE), []);
  assert.deepEqual(findingsFor(app(manifest({ icons: [{ src: "/icons/logo.svg", sizes: "any" }] })), "manifest/install-icons", SITE), []);
  const custom = { rules: { "manifest/install-icons": { sizes: [192] } }, ...SITE };
  assert.deepEqual(findingsFor(app(manifest({ icons })), "manifest/install-icons", custom), []);
});

test("manifest/install-icons validates its sizes option", () => {
  assert.throws(() => findingsFor(app(), "manifest/install-icons", { rules: { "manifest/install-icons": { sizes: [192.5] } } }), /sizes must be a list of whole numbers/);
});

test("manifest/scope reports a start_url or scope that leaves the site, and a start_url outside the scope", () => {
  assert.deepEqual(messages(findingsFor(app(manifest({ start_url: "https://www.example.org/", scope: "/app/" })), "manifest/scope", SITE)), [
    'Web app manifest start_url "https://www.example.org/" is on another host, so browsers ignore it',
  ]);
  assert.deepEqual(messages(findingsFor(app(manifest({ start_url: "/about/?source=app", scope: "/app/" })), "manifest/scope", SITE)), [
    "Web app manifest start_url /about/?source=app is outside the scope /app/, so browsers ignore the scope",
  ]);
  assert.deepEqual(messages(findingsFor(app(manifest({ start_url: "/welcome/" })), "manifest/scope", SITE)), [
    "Web app manifest start_url /welcome/ leads to no page in the build, so the installed app opens on an error",
  ]);
  assert.deepEqual(findingsFor(app(manifest({ start_url: "about/?utm_source=app", scope: undefined })), "manifest/scope", SITE), []);
  assert.deepEqual(findingsFor(app(manifest({ start_url: "https://www.example.com/about/" })), "manifest/scope", SITE), []);
});

test("manifest/colors reports colors that are not CSS colors", () => {
  assert.deepEqual(messages(findingsFor(app(manifest({ theme_color: "#12345", background_color: "white" })), "manifest/colors", SITE)), [
    'Web app manifest theme_color "#12345" is not a CSS color, so browsers ignore it',
  ]);
});

test("manifest/display reports a display that is not a display mode", () => {
  assert.deepEqual(messages(findingsFor(app(manifest({ display: "app" })), "manifest/display", SITE)), [
    'Web app manifest display "app" is not a display mode, so browsers open it in a tab. Use fullscreen, standalone, minimal-ui, browser',
  ]);
  assert.deepEqual(findingsFor(app(manifest({ display: "minimal-ui" })), "manifest/display", SITE), []);
});

test("feed and manifest rules are quiet on the clean fixture site and the clean example", () => {
  withFixtureSite("clean-site", (root) => {
    assert.deepEqual(audit(root, { rules: { "*": "off", "feeds/*": "error", "manifest/*": "error" } }).findings, []);
  });
});
