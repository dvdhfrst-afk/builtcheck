// Language rules: language tags in lang and hreflang, and hreflang sets in pages and in the
// sitemap. Each rule is shown both reporting and staying quiet.

import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { checkHreflang, checkLanguageTag, sameLanguage } from "../src/seo/language-tags.js";
import { parseSitemapAlternates } from "../src/seo/hreflang.js";
import { findingsFor } from "./helpers.js";

const HOST = "https://www.example.com";
const SITE = { site: { url: HOST } };

// A language version: its links start on line 6, one per line.
function version(lang, path, alternates, { extra = "", canonical = true } = {}) {
  const links = alternates.map(([value, href]) => `<link rel="alternate" hreflang="${value}" href="${href}">`).join("\n");
  const canonicalLink = canonical ? `<link rel="canonical" href="${HOST}${path}">` : "<!-- no canonical -->";
  return `<!doctype html>\n<html lang="${lang}">\n<head><meta charset="utf-8">\n<title>Example Bakery in ${lang}</title>\n${canonicalLink}\n${links}\n${extra}</head>\n<body><h1>Example Bakery</h1></body>\n</html>\n`;
}

const SET = [["en", `${HOST}/en/`], ["fr", `${HOST}/fr/`], ["de", `${HOST}/de/`], ["x-default", `${HOST}/en/`]];

function multilingual(overrides = {}) {
  return {
    "en/index.html": version("en", "/en/", SET),
    "fr/index.html": version("fr", "/fr/", SET),
    "de/index.html": version("de", "/de/", SET),
    ...overrides,
  };
}

function sitemap(entries) {
  const urls = entries.map(([loc, links]) => {
    const alternates = links.map(([value, href]) => `  <xhtml:link rel="alternate" hreflang="${value}" href="${href}"/>`).join("\n");
    return `<url>\n  <loc>${loc}</loc>\n${alternates}\n</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

function found(files, rule, config = SITE) {
  return findingsFor(files, rule, config).map((finding) => `${finding.rule} ${finding.file}:${finding.line ?? "-"} ${finding.message}`);
}

// ---- language tags

test("valid language tags pass, in any case", () => {
  for (const tag of [
    "en", "EN", "en-US", "en-us", "zh-Hant-TW", "zh-yue-HK", "sr-Latn-RS", "es-419", "de-CH-1996",
    "en-US-u-ca-gregory", "en-GB-oed", "i-klingon", "fil", "haw", "und", "x-private", "en-x-house", "nb-NO", "gsw-CH", "se",
  ]) {
    assert.ok(checkLanguageTag(tag).ok, tag);
  }
});

test("invalid language tags give a reason and, where it is clear, the fix", () => {
  const reasons = {
    "": /empty/,
    en_US: /underscore where a hyphen belongs \(write "en-US"\)/,
    jp: /"jp" is not a language code \(did you mean "ja"\?\)/,
    eng: /"eng" has a two-letter code, "en", which must be used instead/,
    "en-UK": /the region "UK" is not a country code \(the United Kingdom is "GB"\)/,
    "en-ZX": /the region "ZX" is not an ISO 3166-1 country code/,
    iw: /withdrawn code, now "he"/,
    english: /"english" is not a registered language/,
    abcd: /four-letter first part/,
    "en-": /empty part/,
    "en-a": /the extension "a" has nothing after it/,
    "en-a-bc-a-de": /the extension "a" appears twice/,
    "en-US-x": /"x" must be followed by a private use part/,
    "en US": /characters a language tag cannot contain/,
    "1en": /must start with a language code/,
    "en-verylongpart": /longer than eight characters/,
    "en-US-US": /"us" is not a script, region or variant in that position/,
    qq: /"qq" is not an ISO 639-1 language code/,
    ch: null,
    zz: /not an ISO 639-1 language code/,
    at: /"at" is a country code, not a language code/,
  };
  for (const [tag, reason] of Object.entries(reasons)) {
    const result = checkLanguageTag(tag);
    if (reason === null) {
      assert.ok(result.ok, tag);
    } else {
      assert.equal(result.ok, false, tag);
      assert.match(result.reason, reason, tag);
    }
  }
});

test("extra languages can be accepted", () => {
  assert.equal(checkLanguageTag("xx-US").ok, false);
  assert.ok(checkLanguageTag("xx-US", ["XX"]).ok);
});

test("hreflang allows x-default and no other private use tag", () => {
  assert.ok(checkHreflang("x-default").xDefault);
  assert.ok(checkHreflang("X-Default").xDefault);
  assert.equal(checkHreflang("en-GB").xDefault, false);
  assert.match(checkHreflang("x_default").reason, /must be written "x-default"/);
  assert.match(checkHreflang("default").reason, /must be written "x-default"/);
  assert.match(checkHreflang("x-mine").reason, /private use tags are not recognized/);
  assert.match(checkHreflang("us").reason, /did you mean "en"/);
});

test("languages that share a code compare as the same", () => {
  assert.ok(sameLanguage("no", "nb"));
  assert.ok(sameLanguage("en", "eng"));
  assert.ok(sameLanguage("zh", "yue"));
  assert.ok(sameLanguage("tl", "fil"));
  assert.ok(sameLanguage("he", "iw"));
  assert.equal(sameLanguage("en", "fr"), false);
  assert.equal(sameLanguage("nb", "da"), false);
});

// ---- i18n/lang-invalid

test("lang-invalid reports bad tags on the page and on elements inside it", () => {
  const results = found({
    "a.html": '<!doctype html>\n<html lang="jp">\n<head><title>Example Bakery</title></head>\n<body><p lang="en_US">Hello</p><p lang="">Unknown</p><template><p lang="zz">Later</p></template><p lang="fr-CA">Bonjour</p></body>\n</html>',
    "b.html": '<!doctype html>\n<html lang="en-GB">\n<head><title>Example Bakery</title></head>\n<body></body>\n</html>',
  }, "i18n/lang-invalid");
  assert.deepEqual(results, [
    'i18n/lang-invalid a.html:2 Page language "jp" is not a valid language tag: "jp" is not a language code (did you mean "ja"?)',
    'i18n/lang-invalid a.html:4 lang on <p> "en_US" is not a valid language tag: it uses an underscore where a hyphen belongs (write "en-US")',
  ]);
});

test("lang-invalid takes extra languages as an option", () => {
  const files = { "a.html": '<!doctype html><html lang="xx"><head><title>Example Bakery</title></head><body></body></html>' };
  assert.equal(found(files, "i18n/lang-invalid").length, 1);
  assert.equal(found(files, "i18n/lang-invalid", { rules: { "i18n/lang-invalid": { languages: ["xx"] } } }).length, 0);
});

// ---- i18n/hreflang-invalid

test("hreflang-invalid reports bad values in pages", () => {
  const results = found(multilingual({
    "en/index.html": version("en", "/en/", [["en_US", `${HOST}/en/`], ["fr-UK", `${HOST}/fr/`], ["default", `${HOST}/en/`], ["de", `${HOST}/de/`]]),
  }), "i18n/hreflang-invalid");
  assert.deepEqual(results, [
    'i18n/hreflang-invalid en/index.html:6 hreflang "en_US" is not a valid language tag: it uses an underscore where a hyphen belongs (write "en-US")',
    'i18n/hreflang-invalid en/index.html:7 hreflang "fr-UK" is not a valid language tag: the region "UK" is not a country code (the United Kingdom is "GB")',
    'i18n/hreflang-invalid en/index.html:8 hreflang "default" is not a valid language tag: it must be written "x-default"',
  ]);
});

test("hreflang-invalid reports a bad sitemap value once, with how often it recurs", () => {
  const links = [["en", `${HOST}/en/`], ["fr_FR", `${HOST}/fr/`]];
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "sitemap.xml": sitemap([[`${HOST}/en/`, links], [`${HOST}/fr/`, links]]),
  };
  assert.deepEqual(found(files, "i18n/hreflang-invalid"), [
    'i18n/hreflang-invalid sitemap.xml:6 Sitemap hreflang "fr_FR" is not a valid language tag: it uses an underscore where a hyphen belongs (write "fr-FR") (2 places in the sitemap)',
  ]);
});

// ---- i18n/hreflang-duplicate

test("hreflang-duplicate reports a value given twice, whatever its case", () => {
  const results = found(multilingual({
    "en/index.html": version("en", "/en/", [...SET, ["EN", `${HOST}/en/`], ["fr", `${HOST}/fr-ca/`]]),
  }), "i18n/hreflang-duplicate");
  assert.deepEqual(results, [
    `i18n/hreflang-duplicate en/index.html:10 hreflang "EN" is listed twice for ${HOST}/en/`,
    `i18n/hreflang-duplicate en/index.html:11 hreflang "fr" names two URLs, ${HOST}/fr/ and ${HOST}/fr-ca/, so search engines may ignore both`,
  ]);
});

test("hreflang-duplicate checks sitemap entries too", () => {
  const files = {
    "en/index.html": version("en", "/en/", []),
    "sitemap.xml": sitemap([[`${HOST}/en/`, [["en", `${HOST}/en/`], ["en", `${HOST}/uk/`]]]]),
  };
  assert.deepEqual(found(files, "i18n/hreflang-duplicate"), [
    `i18n/hreflang-duplicate sitemap.xml:6 Sitemap entry for ${HOST}/en/: hreflang "en" names two URLs, ${HOST}/en/ and ${HOST}/uk/, so search engines may ignore both`,
  ]);
});

// ---- i18n/hreflang-self

test("hreflang-self reports a set that leaves out its own page", () => {
  const others = SET.filter(([value]) => value !== "fr" && value !== "x-default");
  const results = found(multilingual({ "fr/index.html": version("fr", "/fr/", others) }), "i18n/hreflang-self");
  assert.deepEqual(results, ["i18n/hreflang-self fr/index.html:6 Page lists other language versions but not itself. Each version must list every version, itself included"]);
});

test("hreflang-self accepts a relative self link, and the canonical URL when the host is unknown", () => {
  const relative = [["en", "/en/"], ["fr", "/fr/"]];
  assert.deepEqual(found({ "en/index.html": version("en", "/en/", relative), "fr/index.html": version("fr", "/fr/", relative) }, "i18n/hreflang-self"), []);
  // No site URL, no sitemap, and canonicals naming paths that are not built: the host is unknown.
  const elsewhere = [["en", "https://www.example.org/en/"], ["fr", "https://www.example.org/fr/"]];
  const unknown = {
    "a.html": version("en", "/en/", elsewhere),
    "b.html": version("fr", "/fr/", elsewhere, { canonical: false }),
  };
  assert.deepEqual(found(unknown, "i18n/hreflang-self", {}), []);
});

test("hreflang-self checks sitemap entries too", () => {
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "sitemap.xml": sitemap([[`${HOST}/en/`, [["fr", `${HOST}/fr/`]]], [`${HOST}/fr/`, [["fr", `${HOST}/fr/`], ["en", `${HOST}/en/`]]]]),
  };
  assert.deepEqual(found(files, "i18n/hreflang-self"), [`i18n/hreflang-self sitemap.xml:3 Sitemap entry for ${HOST}/en/ lists other language versions but not itself`]);
});

// ---- i18n/hreflang-target

test("hreflang-target reports alternates that cannot stand as language versions", () => {
  const set = [["en", `${HOST}/en/`], ["fr", `${HOST}/fr/`], ["de", `${HOST}/de/`], ["it", `${HOST}/it/`], ["es", `${HOST}/es/`], ["nl", `${HOST}/nl/`], ["ja", "https://example.jp/"]];
  const results = found({
    "en/index.html": version("en", "/en/", set),
    "fr/index.html": version("fr", "/fr/", set, { extra: '<meta name="robots" content="noindex">' }),
    "de/index.html": '<!doctype html><html lang="de"><head><meta http-equiv="refresh" content="0; url=/en/"></head></html>',
    "es/index.html": version("es", "/en/", set),
    "nl/index.html": version("nl", "/nl/", set),
    "_redirects": "/it/* /en/ 302\n",
  }, "i18n/hreflang-target");
  const onEnglish = results.filter((line) => line.includes(" en/index.html:"));
  assert.deepEqual(onEnglish, [
    `i18n/hreflang-target en/index.html:7 Alternate hreflang "fr" (${HOST}/fr/) asks not to be indexed, so search engines ignore the set`,
    `i18n/hreflang-target en/index.html:8 Alternate hreflang "de" (${HOST}/de/) only redirects, so search engines ignore the set`,
    `i18n/hreflang-target en/index.html:9 Alternate hreflang "it" (${HOST}/it/) only redirects (to /en/), so search engines ignore the set`,
    `i18n/hreflang-target en/index.html:10 Alternate hreflang "es" (${HOST}/es/) is an error page or names a different page as its canonical, so search engines ignore the set`,
  ]);
  // The noindex page's own set is not held to the checks, and the page that names another canonical is not either.
  assert.ok(!results.some((line) => line.includes(" fr/index.html:") || line.includes(" es/index.html:")));
});

test("hreflang-target reports a missing page unless links/broken-internal already does", () => {
  const files = multilingual({ "de/index.html": undefined });
  delete files["de/index.html"];
  assert.equal(found(files, "i18n/hreflang-target").length, 2);
  const both = findingsFor(files, "i18n/hreflang-target", { ...SITE, rules: { "links/broken-internal": "error" } });
  assert.ok(both.length > 0 && both.every((finding) => finding.rule === "links/broken-internal"));
});

test("hreflang-target checks sitemap alternates, including relative ones", () => {
  const links = [["en", `${HOST}/en/`], ["fr", "/fr/"], ["de", `${HOST}/de/`]];
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "sitemap.xml": sitemap([[`${HOST}/en/`, links], [`${HOST}/fr/`, links]]),
  };
  assert.deepEqual(found(files, "i18n/hreflang-target"), [
    'i18n/hreflang-target sitemap.xml:6 Sitemap alternate hreflang "fr" (/fr/) is not an absolute URL, which sitemaps require (2 places in the sitemap)',
    `i18n/hreflang-target sitemap.xml:7 Sitemap alternate hreflang "de" (${HOST}/de/) is not in the build (2 places in the sitemap)`,
  ]);
});

// ---- i18n/hreflang-reciprocal

test("hreflang-reciprocal reports versions that do not link back", () => {
  const results = found(multilingual({
    "fr/index.html": version("fr", "/fr/", []),
    "de/index.html": version("de", "/de/", [["de", `${HOST}/de/`], ["fr", `${HOST}/fr/`]]),
  }), "i18n/hreflang-reciprocal");
  assert.deepEqual(results, [
    `i18n/hreflang-reciprocal de/index.html:7 Alternate hreflang "fr" (${HOST}/fr/) has no hreflang links, so it does not link back. Both pages must name each other`,
    `i18n/hreflang-reciprocal en/index.html:7 Alternate hreflang "fr" (${HOST}/fr/) has no hreflang links, so it does not link back. Both pages must name each other`,
    `i18n/hreflang-reciprocal en/index.html:8 Alternate hreflang "de" (${HOST}/de/) lists language versions, but not this page. Both pages must name each other`,
  ]);
});

test("hreflang-reciprocal is quiet on complete sets, other hosts and an x-default chooser", () => {
  const set = [...SET.slice(0, 3), ["ja", "https://example.jp/"], ["x-default", `${HOST}/`]];
  const files = {
    "index.html": '<!doctype html><html lang="en"><head><title>Choose a language</title></head><body><h1>Example Bakery</h1></body></html>',
    "en/index.html": version("en", "/en/", set),
    "fr/index.html": version("fr", "/fr/", set),
    "de/index.html": version("de", "/de/", set),
  };
  assert.deepEqual(found(files, "i18n/hreflang-reciprocal"), []);
});

test("hreflang-reciprocal checks the sitemap, including versions with no entry of their own", () => {
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "de/index.html": version("de", "/de/", []),
    "sitemap.xml": sitemap([
      [`${HOST}/en/`, [["en", `${HOST}/en/`], ["fr", `${HOST}/fr/`], ["de", `${HOST}/de/`]]],
      [`${HOST}/fr/`, [["fr", `${HOST}/fr/`]]],
    ]),
  };
  assert.deepEqual(found(files, "i18n/hreflang-reciprocal"), [
    `i18n/hreflang-reciprocal sitemap.xml:6 Sitemap entry for ${HOST}/fr/ does not list ${HOST}/en/ back as an alternate`,
    `i18n/hreflang-reciprocal sitemap.xml:7 Sitemap lists ${HOST}/de/ as an alternate, but has no entry of its own for it listing the alternates back`,
  ]);
});

// ---- i18n/x-default

test("x-default reports a lone x-default and versions that disagree on it", () => {
  const results = found(multilingual({
    "de/index.html": version("de", "/de/", [...SET.slice(0, 3), ["x-default", `${HOST}/de/`]]),
    "solo.html": version("en", "/solo.html", [["x-default", `${HOST}/solo.html`]]),
  }), "i18n/x-default");
  assert.deepEqual(results.map((line) => line.split(" ").slice(0, 2).join(" ")), [
    "i18n/x-default de/index.html:9", "i18n/x-default en/index.html:9", "i18n/x-default fr/index.html:9", "i18n/x-default solo.html:6",
  ]);
  assert.match(results[0], new RegExp(`x-default is ${HOST}/de/ here, but ${HOST}/en/ names ${HOST}/en/\\. Every version should name the same x-default`));
  assert.match(results[3], /Only an x-default alternate is given/);
});

test("x-default is quiet when every version names the same one, or none", () => {
  assert.deepEqual(found(multilingual(), "i18n/x-default"), []);
  const set = SET.slice(0, 3);
  assert.deepEqual(found(multilingual({ "en/index.html": version("en", "/en/", set) }), "i18n/x-default"), []);
});

test("x-default checks the sitemap too", () => {
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "sitemap.xml": sitemap([
      [`${HOST}/en/`, [["en", `${HOST}/en/`], ["fr", `${HOST}/fr/`], ["x-default", `${HOST}/en/`]]],
      [`${HOST}/fr/`, [["en", `${HOST}/en/`], ["fr", `${HOST}/fr/`], ["x-default", `${HOST}/fr/`]]],
    ]),
  };
  const results = found(files, "i18n/x-default");
  assert.equal(results.length, 2);
  assert.match(results[0], /sitemap\.xml:7 Sitemap entry for https:\/\/www\.example\.com\/en\/: x-default is/);
});

// ---- i18n/lang-mismatch

test("lang-mismatch reports a page whose lang disagrees with the hreflang it is given", () => {
  const results = found(multilingual({ "de/index.html": version("fr", "/de/", SET) }), "i18n/lang-mismatch");
  assert.deepEqual(results, ['i18n/lang-mismatch de/index.html:2 Page has lang "fr", but en/index.html, fr/index.html and this page list it as hreflang "de". One of them is wrong']);
});

test("lang-mismatch allows regions, shared codes and three-letter forms", () => {
  const set = [["en-GB", `${HOST}/en/`], ["no", `${HOST}/no/`], ["fil", `${HOST}/ph/`]];
  assert.deepEqual(found({
    "en/index.html": version("en-US", "/en/", set),
    "no/index.html": version("nb", "/no/", set),
    "ph/index.html": version("tl", "/ph/", set),
  }, "i18n/lang-mismatch"), []);
});

test("lang-mismatch compares the sitemap with the pages", () => {
  const links = [["en", `${HOST}/en/`], ["de", `${HOST}/fr/`]];
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "sitemap.xml": sitemap([[`${HOST}/en/`, links], [`${HOST}/fr/`, links]]),
  };
  assert.deepEqual(found(files, "i18n/lang-mismatch"), [
    'i18n/lang-mismatch sitemap.xml:6 Sitemap gives fr/index.html hreflang "de", but that page has lang "fr" (2 places in the sitemap)',
  ]);
});

// ---- the sitemap reader

test("sitemap alternates are read with any namespace prefix, comments, CDATA and entities", () => {
  const text = [
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:x="http://www.w3.org/1999/xhtml">',
    "<!-- <url><loc>https://www.example.com/commented/</loc><x:link rel=\"alternate\" hreflang=\"en\" href=\"https://www.example.com/c/\"/></url> -->",
    "<url><loc><![CDATA[https://www.example.com/en/?a=1&b=2]]></loc>",
    "<x:link rel='alternate' hreflang='en' href='https://www.example.com/en/?a=1&amp;b=2'/>",
    '<x:link rel="alternate" hreflang="fr" href="https://www.example.com/fr/"/>',
    '<x:link rel="stylesheet" href="https://www.example.com/s.css"/>',
    "</url>",
    "<url><loc>https://www.example.com/plain/</loc></url>",
    "</urlset>",
  ].join("\n");
  const entries = parseSitemapAlternates(text);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].loc, "https://www.example.com/en/?a=1&b=2");
  assert.deepEqual(entries[0].links.map(({ hreflang, href }) => `${hreflang} ${href}`), ["en https://www.example.com/en/?a=1&b=2", "fr https://www.example.com/fr/"]);
});

test("a compressed sitemap is read too", () => {
  const links = [["en", `${HOST}/en/`], ["fr", `${HOST}/fr/`], ["de_DE", `${HOST}/en/`]];
  const files = {
    "en/index.html": version("en", "/en/", []),
    "fr/index.html": version("fr", "/fr/", []),
    "sitemap.xml.gz": gzipSync(sitemap([[`${HOST}/en/`, links], [`${HOST}/fr/`, links]])),
  };
  const results = found(files, "i18n/hreflang-invalid");
  assert.equal(results.length, 1);
  assert.match(results[0], /sitemap\.xml\.gz:- Sitemap hreflang "de_DE"/);
});

// ---- whole sites

test("a well built multilingual site gets no language or metadata alternate findings", () => {
  const set = [...SET.slice(0, 3), ["x-default", `${HOST}/`]];
  const links = set.map(([value, href]) => [value, href]);
  const files = {
    "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example Bakery, choose a language</title></head><body><h1>Example Bakery</h1><p lang="fr">Bienvenue</p></body></html>',
    "en/index.html": version("en", "/en/", set),
    "fr/index.html": version("fr-FR", "/fr/", set),
    "de/index.html": version("de", "/de/", set),
    "sitemap.xml": sitemap([[`${HOST}/en/`, links], [`${HOST}/fr/`, links], [`${HOST}/de/`, links]]),
  };
  assert.deepEqual(found(files, "i18n/*"), []);
  // The sitemap and canonicals settle the host, so no site URL is needed.
  assert.deepEqual(found(files, "i18n/*", {}), []);
  const meta = found(files, "meta/*").filter((line) => /canonical|title-duplicate/.test(line));
  assert.deepEqual(meta, []);
});

test("feed links and anchors that carry hreflang are not language versions", () => {
  const files = {
    "index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Example Bakery news</title><link rel="alternate" type="application/rss+xml" hreflang="en" href="/feed.xml"></head><body><h1>News</h1><a href="${HOST}/fr/" hreflang="fr">Français</a></body></html>`,
    "fr/index.html": version("fr", "/fr/", []),
    "feed.xml": "<rss/>",
  };
  assert.deepEqual(found(files, "i18n/*"), []);
});

test("unquoted and upper case markup is read like any other", () => {
  const page = (lang, path) => `<!DOCTYPE html><HTML LANG=${lang}><HEAD><TITLE>Example Bakery ${lang}</TITLE><LINK REL=Alternate HREFLANG=EN HREF=${HOST}/en/><LINK REL=ALTERNATE HREFLANG=fr HREF=${HOST}/fr/><LINK REL=canonical HREF=${HOST}${path}></HEAD><BODY><H1>x</H1></BODY></HTML>`;
  const files = { "en/index.html": page("en", "/en/"), "fr/index.html": page("de", "/fr/") };
  assert.deepEqual(found(files, "i18n/*"), ['i18n/lang-mismatch fr/index.html:1 Page has lang "de", but en/index.html and this page list it as hreflang "fr". One of them is wrong']);
});
