// Structured data values and how they connect: dates, durations, URLs, prices, ratings and
// enumerations, then @id references, breadcrumbs, search actions and what pages agree on.

import assert from "node:assert/strict";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { dateProblem, durationProblem, endsBeforeStart, parseIsoDate } from "../src/schema/values.js";
import { findingsFor, page, withSite } from "./helpers.js";

const ld = (object) => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
const context = { "@context": "https://schema.org" };
const messages = (found) => found.map((f) => f.message).sort();
const site = (...objects) => ({ "index.html": page("x", objects.map(ld).join("")) });
const check = (rule, object, config) => messages(findingsFor(site(object), rule, config));
const OWN = { site: { url: "https://example.com" } };

// ---- dates

test("ISO 8601 dates and date-times at every precision are accepted", () => {
  for (const value of ["2026", "2026-05", "2026-05-01", "2026-05-01T19:00", "2026-05-01T19:00:30", "2026-05-01T19:00:30.250Z", "2026-05-01T19:00:00-07:00", "2026-05-01T19:00:00+0530", "2024-02-29", " 2026-05-01 "]) {
    assert.equal(dateProblem(value), null, value);
  }
});

test("other date forms are explained", () => {
  assert.match(dateProblem("05/01/2026"), /not an ISO 8601 date such as 2026-05-01/);
  assert.match(dateProblem("2026-05-01 19:00"), /space instead of a T/);
  assert.match(dateProblem("2026-02-30"), /not a real date/);
  assert.match(dateProblem("2025-02-29"), /not a real date/);
  assert.match(dateProblem("2026-05-01T25:00"), /not a real date or time/);
  assert.match(dateProblem("2026-05-01T10:00+15:00"), /not a real date or time/);
  assert.notEqual(dateProblem("May 1, 2026"), null);
  assert.notEqual(dateProblem("20260501"), null);
});

test("a date covers its whole span, so a same-day end is not before a timed start", () => {
  const day = parseIsoDate("2026-05-01");
  assert.equal(day.last - day.first, 24 * 3600 * 1000 - 1);
  assert.equal(parseIsoDate("0099-01-01").first, new Date("0099-01-01T00:00:00Z").getTime(), "years below 100 stay themselves");
  assert.ok(!endsBeforeStart(parseIsoDate("2026-05-01T20:00:00-07:00"), parseIsoDate("2026-05-01")));
  assert.ok(endsBeforeStart(parseIsoDate("2026-05-02"), parseIsoDate("2026-04-29")));
  assert.ok(!endsBeforeStart(parseIsoDate("2026-05-02T01:00:00+10:00"), parseIsoDate("2026-05-01T20:00:00")), "unzoned against zoned allows the widest gap");
  assert.ok(endsBeforeStart(parseIsoDate("2026-05-02T01:00:00+10:00"), parseIsoDate("2026-05-01T14:00:00Z")));
});

test("schema/invalid-date reports the node and field, at any depth", () => {
  const event = { ...context, "@type": "Event", name: "Tasting", startDate: "next Friday", offers: { "@type": "Offer", validFrom: "2026-13-01" } };
  assert.deepEqual(check("schema/invalid-date", event), [
    'Event "Tasting" has "startDate" "next Friday", which is not an ISO 8601 date such as 2026-05-01 or 2026-05-01T19:00:00-07:00',
    'Offer at offers has "validFrom" "2026-13-01", which is not a real date or time',
  ]);
  assert.deepEqual(check("schema/invalid-date", { ...context, "@type": "Organization", name: "O", foundingDate: 1999, dissolutionDate: "" }), [], "numbers and empty values are left alone");
});

test("schema/invalid-date fields are configurable", () => {
  const object = { ...context, "@type": "Event", name: "E", startDate: "soon", doorTime: "later" };
  const found = check("schema/invalid-date", object, { rules: { "schema/invalid-date": { fields: ["doorTime"] } } });
  assert.deepEqual(found, ['Event "E" has "doorTime" "later", which is not an ISO 8601 date such as 2026-05-01 or 2026-05-01T19:00:00-07:00']);
});

test("schema/date-order reports an end before its start", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Event", name: "Tasting", startDate: "2026-05-02", endDate: "2026-05-01" },
      { "@type": "Offer", price: 1, validFrom: "2026-06-01", validThrough: "2026-05-01T00:00:00Z" },
      { "@type": "BlogPosting", headline: "H", datePublished: "2026-03-01", dateModified: "2026-02-01" },
      { "@type": "Event", name: "Same day", startDate: "2026-05-01T19:00:00-07:00", endDate: "2026-05-01" },
      { "@type": "Event", name: "Bad date", startDate: "soon", endDate: "2026-05-01" },
    ],
  };
  assert.deepEqual(check("schema/date-order", graph), [
    'BlogPosting "H" at @graph[2] has "dateModified" "2026-02-01", which is before its "datePublished" "2026-03-01"',
    'Event "Tasting" at @graph[0] has "endDate" "2026-05-01", which is before its "startDate" "2026-05-02"',
    'Offer at @graph[1] has "validThrough" "2026-05-01T00:00:00Z", which is before its "validFrom" "2026-06-01"',
  ]);
});

test("schema/date-order pairs are configurable and validated", () => {
  const object = { ...context, "@type": "Event", name: "E", doorTime: "2026-05-01T20:00", startDate: "2026-05-01T19:00" };
  const config = { rules: { "schema/date-order": { pairs: [["doorTime", "startDate"]] } } };
  assert.equal(check("schema/date-order", object, config).length, 1);
  withSite(site(object), (root) => {
    assert.throws(() => audit(root, { rules: { "schema/date-order": { pairs: [["only-one"]] } } }), /pairs of field names/);
  });
});

// ---- durations

test("ISO 8601 durations are accepted, and minutes written as months are caught where it matters", () => {
  for (const value of ["PT30M", "PT1H15M", "P1DT2H", "PT0.5S", "P2W", "P1Y2M3DT4H5M6S"]) assert.equal(durationProblem(value, true), null, value);
  for (const value of ["30 minutes", "PT", "P", "pt30m", "PT30", "1:30"]) assert.notEqual(durationProblem(value, false), null, value);
  assert.match(durationProblem("P30M", true), /means 30 months; for 30 minutes write PT30M/);
  assert.equal(durationProblem("P3M", false), null);
});

test("schema/invalid-duration reports recipe and video times", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Recipe", name: "Rye", cookTime: "P45M", prepTime: "20 min", totalTime: 65 },
      { "@type": "VideoObject", name: "Kneading", duration: "P2M" },
      { "@type": "Course", name: "Bread 101", timeRequired: "P3M" },
      { "@type": "HowTo", name: "Build an oven", totalTime: "P2M" },
    ],
  };
  assert.deepEqual(check("schema/invalid-duration", graph), [
    'Recipe "Rye" at @graph[0] has "cookTime" "P45M", which means 45 months; for 45 minutes write PT45M',
    'Recipe "Rye" at @graph[0] has "prepTime" "20 min", which is not an ISO 8601 duration such as PT30M or PT1H15M',
    'Recipe "Rye" at @graph[0] has "totalTime" 65, which is a bare number; write an ISO 8601 duration such as PT30M',
    'VideoObject "Kneading" at @graph[1] has "duration" "P2M", which means 2 months; for 2 minutes write PT2M',
  ]);
});

// ---- URLs

test("schema/relative-url reports URLs consumers cannot resolve", () => {
  const object = {
    ...context,
    "@type": "Organization",
    name: "O",
    url: "/",
    logo: "//cdn.example.com/logo.png",
    sameAs: ["https://social.example.org/o", "mailto:hello@example.com"],
    image: { "@type": "ImageObject", contentUrl: "img/o.png" },
  };
  assert.deepEqual(check("schema/relative-url", object), [
    'ImageObject at image has "contentUrl" "img/o.png", which is a relative URL; consumers that read the data apart from the page cannot resolve it, so write the full address',
    'Organization "O" has "logo" "//cdn.example.com/logo.png", which has no scheme; start it with https:',
    'Organization "O" has "sameAs" "mailto:hello@example.com", which is not an http or https URL',
    'Organization "O" has "url" "/", which is a relative URL; consumers that read the data apart from the page cannot resolve it, so write the full address',
  ]);
});

test("schema/relative-url checks breadcrumb items given as objects, and is quiet on full URLs", () => {
  const crumbs = { ...context, "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: { "@id": "/" } }, { "@type": "ListItem", position: 2, name: "Here" }] };
  assert.equal(check("schema/relative-url", crumbs).length, 1);
  const fine = { ...context, "@type": "Organization", name: "O", "@id": "#org", url: "https://example.com/", logo: { "@id": "#logo" } };
  assert.deepEqual(check("schema/relative-url", fine), []);
});

test("schema/broken-url reports structured data URLs that lead nowhere in the build", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Organization", name: "O", url: "https://example.com/", logo: "https://example.com/missing-logo.png" },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://www.example.com/" }, { "@type": "ListItem", position: 2, name: "Gone", item: { "@id": "https://example.com/gone/" } }, { "@type": "ListItem", position: 3, name: "Here" }] },
      { "@type": "VideoObject", name: "V", thumbnailUrl: "/Thumb.png", contentUrl: "https://videos.example.org/v.mp4" },
      { "@type": "Article", headline: "A", image: ["/a.png", "/b.png"] },
    ],
  };
  const files = { "index.html": page("x", ld(graph)), "a.png": "png", "thumb.png": "png" };
  assert.deepEqual(messages(findingsFor(files, "schema/broken-url", OWN)), [
    'Article "A" at @graph[3] has "image" "/b.png", which leads to nothing in the build',
    'ListItem "Gone" at @graph[1].itemListElement[1] has "item" "https://example.com/gone/", which leads to nothing in the build',
    'Organization "O" at @graph[0] has "logo" "https://example.com/missing-logo.png", which leads to nothing in the build',
    'VideoObject "V" at @graph[2] has "thumbnailUrl" "/Thumb.png", which differs only in letter case from thumb.png, which breaks on case-sensitive hosts',
  ]);
});

test("schema/broken-url leaves other hosts alone when the site's own host is unknown", () => {
  const object = { ...context, "@type": "Organization", name: "O", url: "https://example.com/nowhere/" };
  assert.deepEqual(check("schema/broken-url", object), []);
  assert.equal(check("schema/broken-url", object, OWN).length, 1);
});

// ---- prices, currencies, ratings

test("schema/invalid-price wants plain numbers and a range that runs upwards", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Offer", price: "$4.50" },
      { "@type": "Offer", price: "1,299.00" },
      { "@type": "Offer", price: "Free" },
      { "@type": "Offer", price: -1 },
      { "@type": "AggregateOffer", lowPrice: "30", highPrice: 20, priceCurrency: "USD" },
      { "@type": "Offer", price: "4.50" },
      { "@type": "Offer", price: 0 },
      { "@type": "Offer", priceSpecification: { "@type": "PriceSpecification", price: "12,50" } },
    ],
  };
  assert.deepEqual(check("schema/invalid-price", graph), [
    'AggregateOffer at @graph[4] has "lowPrice" 30 above its "highPrice" 20',
    'Offer at @graph[0] has "price" "$4.50", which holds more than a number; give the currency in "priceCurrency" and the amount alone',
    'Offer at @graph[1] has "price" "1,299.00", which uses a comma; write the number with a dot for decimals and no thousands separator',
    'Offer at @graph[2] has "price" "Free", which is not a number',
    'Offer at @graph[3] has "price" -1, which is negative',
    'PriceSpecification at @graph[7].priceSpecification has "price" "12,50", which uses a comma; write the number with a dot for decimals and no thousands separator',
  ]);
});

test("schema/invalid-currency wants ISO 4217 codes", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Offer", price: 1, priceCurrency: "usd" },
      { "@type": "Offer", price: 1, priceCurrency: "$" },
      { "@type": "Offer", price: 1, priceCurrency: "Dollars" },
      { "@type": "JobPosting", title: "T", baseSalary: { "@type": "MonetaryAmount", currency: "EUR", value: 1 }, salaryCurrency: "GBP" },
      { "@type": "Offer", price: 1, priceCurrency: "BTC" },
    ],
  };
  assert.deepEqual(check("schema/invalid-currency", graph), [
    'Offer at @graph[0] has "priceCurrency" "usd", which is not in capitals; write USD',
    'Offer at @graph[1] has "priceCurrency" "$", which is a symbol; write the ISO 4217 code, such as USD',
    'Offer at @graph[2] has "priceCurrency" "Dollars", which is not an ISO 4217 currency code such as USD or EUR',
    'Offer at @graph[4] has "priceCurrency" "BTC", which is not an ISO 4217 currency code such as USD or EUR',
  ]);
  const config = { rules: { "schema/invalid-currency": { extraCodes: ["BTC"] } } };
  assert.equal(check("schema/invalid-currency", graph, config).length, 3);
});

test("schema/rating-range keeps ratings inside their scale", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "AggregateRating", ratingValue: 9, ratingCount: 3 },
      { "@type": "Rating", ratingValue: 9, bestRating: 10 },
      { "@type": "Rating", ratingValue: "4,5" },
      { "@type": "Rating", ratingValue: 0 },
      { "@type": "Rating", ratingValue: 3, bestRating: 1, worstRating: 5 },
      { "@type": "Rating", ratingValue: "4.5" },
      { "@type": "Rating", ratingValue: 0, worstRating: 0 },
      { "@type": "Rating", ratingValue: 3, bestRating: "ten" },
    ],
  };
  assert.deepEqual(check("schema/rating-range", graph), [
    'AggregateRating at @graph[0] has "ratingValue" 9, outside its range of 1 to 5; set "bestRating" if the scale is not 1 to 5',
    'Rating at @graph[2] has "ratingValue" "4,5", which is not a number; use a dot for decimals',
    'Rating at @graph[3] has "ratingValue" 0, outside its range of 1 to 5; set "bestRating" if the scale is not 1 to 5',
    'Rating at @graph[4] has "bestRating" 1, which is not above its "worstRating" 5',
    'Rating at @graph[7] has "bestRating" "ten", which is not a number',
  ]);
  const tenPoint = { rules: { "schema/rating-range": { bestRating: 10 } } };
  assert.equal(check("schema/rating-range", { ...context, "@type": "Rating", ratingValue: 9 }, tenPoint).length, 0);
});

// ---- enumerations and context

test("schema/invalid-enum accepts member names in every spelling and suggests close ones", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Offer", price: 1, availability: "https://schema.org/InStock", itemCondition: "http://schema.org/NewCondition" },
      { "@type": "Offer", price: 1, availability: "schema:PreOrder" },
      { "@type": "Offer", price: 1, availability: { "@id": "https://schema.org/SoldOut" } },
      { "@type": "Offer", price: 1, availability: "In Stock" },
      { "@type": "Event", name: "E", eventStatus: "Scheduled", eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Mo-Fr"] },
    ],
  };
  assert.deepEqual(check("schema/invalid-enum", graph), [
    'Event "E" at @graph[4] has "eventStatus" "Scheduled", which is not one of its schema.org members, such as EventScheduled, EventCancelled, EventMovedOnline',
    'Offer at @graph[3] has "availability" "In Stock", which is not a schema.org member; did you mean InStock?',
    'OpeningHoursSpecification at @graph[5] has "dayOfWeek" "Mo-Fr", which is not one of its schema.org members, such as Monday, Tuesday, Wednesday',
  ]);
});

test("schema/invalid-enum lists are configurable and validated", () => {
  const object = { ...context, "@type": "Offer", price: 1, availability: "InStock", deliveryMethod: "Pigeon" };
  const config = { rules: { "schema/invalid-enum": { enumerations: { deliveryMethod: ["OnSitePickup"] } } } };
  assert.equal(check("schema/invalid-enum", object, config).length, 1);
  withSite(site(object), (root) => {
    assert.throws(() => audit(root, { rules: { "schema/invalid-enum": { enumerations: { availability: "InStock" } } } }), /must be a list of member names/);
  });
});

test("schema/unknown-context reports schema.org addresses consumers do not recognize", () => {
  for (const good of ["https://schema.org", "http://schema.org/", "https://www.schema.org", "https://schema.org/docs/jsonldcontext.jsonld", ["https://schema.org", { a: "b" }], { "@vocab": "https://schema.org/" }, "https://example.org/vocab"]) {
    assert.deepEqual(check("schema/unknown-context", { "@context": good, "@type": "Thing" }), [], JSON.stringify(good));
  }
  assert.deepEqual(check("schema/unknown-context", { "@context": "schema.org", "@type": "Thing" }), ['JSON-LD "@context" "schema.org" is not a schema.org address; write "https://schema.org"']);
  assert.equal(check("schema/unknown-context", { "@context": "https://schema.org/Product", "@type": "Product" }).length, 1);
  assert.deepEqual(check("schema/unknown-context", { "@context": { "@vocab": "https://schema.org" }, "@type": "Thing" }), ['JSON-LD "@vocab" "https://schema.org" is not the schema.org vocabulary; write "https://schema.org/" with its final slash']);
});

// ---- references between nodes

test("schema/unresolved-id reports references to nodes the page does not define", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Article", "@id": "#article", headline: "H", author: { "@id": "#jane" }, publisher: { "@id": "https://example.com/#org" }, isPartOf: { "@id": "https://example.com/" } },
      { "@type": "WebPage", "@id": "https://example.com/#page", about: { "@id": "https://www.wikidata.example.org/Q1" }, mainEntity: { "@id": "#article" }, hasPart: { "@id": "_:part" } },
    ],
  };
  assert.deepEqual(messages(findingsFor(site(graph), "schema/unresolved-id", OWN)), [
    'Article "H" (@id #article) has "author" pointing at @id #jane, but no node on this page defines it. Search engines read one page at a time, so define it here too',
    'Article "H" (@id #article) has "publisher" pointing at @id https://example.com/#org, but no node on this page defines it. Search engines read one page at a time, so define it here too',
    'WebPage (@id https://example.com/#page) has "hasPart" pointing at @id _:part, but no node on this page defines it. Search engines read one page at a time, so define it here too',
  ]);
});

test("schema/unresolved-id matches every spelling of the same @id, across blocks", () => {
  const files = {
    "about/index.html": page("x", ld({ ...context, "@type": "Organization", "@id": "https://example.com/about/#org", name: "O" }) + ld({ ...context, "@type": "WebPage", name: "About", publisher: { "@id": "#org" }, author: { "@id": "/about/#org" } })),
  };
  assert.deepEqual(findingsFor(files, "schema/unresolved-id", OWN), []);
  const elsewhere = { "about/index.html": page("x", ld({ ...context, "@type": "WebPage", name: "About", publisher: { "@id": "https://example.com/#org" } })) };
  assert.deepEqual(findingsFor(elsewhere, "schema/unresolved-id"), [], "with no known host, an absolute @id may be anyone's");
});

test("schema/conflicting-id reports one @id used for different things on a page", () => {
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Organization", "@id": "#main", name: "Example Bakery" },
      { "@type": "WebSite", "@id": "#main", url: "https://example.com/" },
      { "@type": "Organization", "@id": "#org", name: "Example Bakery" },
      { "@type": "Bakery", "@id": "#org", name: "Example Bakery Co" },
      { "@type": "Organization", "@id": "#same", name: "Example Bakery", url: "https://example.com" },
      { "@type": "Bakery", "@id": "#same", url: "https://example.com/", address: { "@type": "PostalAddress", addressLocality: "Sampleville" } },
    ],
  };
  assert.deepEqual(check("schema/conflicting-id", graph), [
    '@id #main is used for both Organization and WebSite on this page',
    '@id #org has two different "name" values: "Example Bakery" and "Example Bakery Co" on this page',
  ]);
});

test("schema/breadcrumb-position wants 1, 2, 3 with no gaps or repeats", () => {
  const list = (...positions) => ({ ...context, "@type": "BreadcrumbList", itemListElement: positions.map((position, index) => ({ "@type": "ListItem", position, name: `P${index}`, item: "https://example.com/" })) });
  assert.deepEqual(check("schema/breadcrumb-position", list(0, 1, 2)), ["BreadcrumbList has positions 0, 1, 2; they must run from 1 to 3 with no gaps or repeats"]);
  assert.equal(check("schema/breadcrumb-position", list(1, 3)).length, 1);
  assert.equal(check("schema/breadcrumb-position", list(1, 1, 2)).length, 1);
  assert.deepEqual(check("schema/breadcrumb-position", list(1, "two")), ['BreadcrumbList has "position" "two", which is not a whole number']);
  assert.deepEqual(check("schema/breadcrumb-position", list(1, 2, 3)), []);
  assert.deepEqual(check("schema/breadcrumb-position", list("1", "2")), [], "numeric strings are positions");
  assert.deepEqual(check("schema/breadcrumb-position", list(2, 1)), [], "consumers sort by position, so array order does not matter");
  const missing = { ...context, "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", name: "Home" }] };
  assert.deepEqual(check("schema/breadcrumb-position", missing), [], "a missing position is the required-field rule's to report");
});

test("schema/search-action checks the template, its query-input and the search page", () => {
  const action = (extra) => ({ ...context, "@type": "WebSite", url: "https://example.com/", potentialAction: { "@type": "SearchAction", ...extra } });
  const files = (object) => ({ "index.html": page("x", ld(object)), "search/index.html": page("search") });
  const run = (extra) => messages(findingsFor(files(action(extra)), "schema/search-action", OWN));
  assert.deepEqual(run({ target: "https://example.com/search/?q={search_term_string}", "query-input": "required name=search_term_string" }), []);
  assert.deepEqual(run({ target: { "@type": "EntryPoint", urlTemplate: "https://example.com/tags/{search_term_string}/" }, "query-input": { valueName: "search_term_string" } }), [], "a placeholder in the path stands for many pages");
  assert.deepEqual(run({ "query-input": "required name=q" }), ['SearchAction at potentialAction has no "target" URL template']);
  assert.deepEqual(run({ target: "https://example.com/search/?q=", "query-input": "required name=q" }), ['SearchAction at potentialAction has "target" "https://example.com/search/?q=", which has no placeholder such as {search_term_string}']);
  assert.deepEqual(run({ target: "https://example.com/search/?q={search_term_string}", "query-input": "required name=query" }), ['SearchAction at potentialAction has "query-input" naming query, but its "target" has {search_term_string}']);
  assert.deepEqual(run({ target: "https://example.com/search/?q={search_term_string}" }), ['SearchAction at potentialAction has no "query-input", so consumers cannot tell which placeholder takes the search terms']);
  assert.deepEqual(run({ target: "https://example.com/search/?q={search_term_string}", "query-input": "required" }), ['SearchAction at potentialAction has a "query-input" that names no placeholder; write "required name=search_term_string"']);
  assert.deepEqual(run({ target: "https://example.com/find?q={search_term_string}", "query-input": "required name=search_term_string" }), ['SearchAction at potentialAction has "target" "https://example.com/find?q={search_term_string}", whose search page /find is not in the build']);
});

// ---- across pages

// Pages are read in file order, so the first page to name an @id is the one others are compared with.
test("schema/inconsistent-entity reports a name that changes across pages, once per @id", () => {
  const org = (name) => ld({ ...context, "@type": "Organization", "@id": "https://example.com/#org", name, url: "https://example.com/" });
  const files = {
    "index.html": page("x", org("Example Bakery")),
    "about/index.html": page("x", org("Example Bakery Co")),
    "contact/index.html": page("x", org("Example Bakery Ltd")),
    "blog/index.html": page("x", org("Example Bakery") + ld({ ...context, "@type": "WebSite", "@id": "#site", name: "Blog", url: "https://example.com/blog/" })),
    "blog/a/index.html": page("x", ld({ ...context, "@type": "WebSite", "@id": "#site", name: "Another blog", url: "https://example.com/blog/a/" })),
  };
  const found = findingsFor(files, "schema/inconsistent-entity", OWN);
  assert.deepEqual(found.map((f) => `${f.file}: ${f.message}`), [
    'blog/index.html: Organization "Example Bakery" (@id https://example.com/#org) has "name" "Example Bakery" here, but "Example Bakery Co" on about/index.html',
  ]);
});

test("schema/inconsistent-entity matches relative and absolute spellings of one @id, and is configurable", () => {
  const files = {
    "index.html": page("x", ld({ ...context, "@type": "WebSite", "@id": "#site", name: "Example Bakery", url: "https://example.com/" })),
    "about/index.html": page("x", ld({ ...context, "@type": "WebSite", "@id": "https://example.com/#site", name: "Example Bakery Shop", url: "https://example.com/" })),
    "contact/index.html": page("x", ld({ ...context, "@type": "Person", "@id": "https://example.com/#jane", name: "Jane Doe" }) ),
    "team/index.html": page("x", ld({ ...context, "@type": "Person", "@id": "https://example.com/#jane", name: "J. Doe" })),
  };
  assert.equal(findingsFor(files, "schema/inconsistent-entity", OWN).length, 1);
  const config = { ...OWN, rules: { "schema/inconsistent-entity": { types: ["Person"] } } };
  assert.deepEqual(findingsFor(files, "schema/inconsistent-entity", config).map((f) => f.file), ["team/index.html"]);
});

// ---- the whole set

test("a node with problems in several values reports each one through its own rule", () => {
  const product = {
    ...context,
    "@type": "Product",
    name: "Loaf",
    image: "/loaf.png",
    offers: { "@type": "Offer", price: "€4", priceCurrency: "eur", availability: "instock", priceValidUntil: "31/12/2026" },
  };
  const found = findingsFor({ "index.html": page("x", ld(product)) }, "schema/*", { rules: { "schema/page-missing": "off", "schema/recommended-field": "off" } });
  assert.deepEqual(found.map((f) => f.rule).sort(), ["schema/broken-url", "schema/invalid-currency", "schema/invalid-date", "schema/invalid-enum", "schema/invalid-price", "schema/relative-url"]);
});

test("hostile JSON-LD keys do not reach the prototype or break a rule", () => {
  const block = '<script type="application/ld+json">{"@context":"https://schema.org","@type":["constructor","toString","Product"],"constructor":{"@id":"#x"},"toString":"PT30M","availability":{"__proto__":1},"price":{},"ratingValue":{"valueOf":1},"@graph":[{"@type":"BreadcrumbList","itemListElement":[{"position":{"x":1}}]}]}</script>';
  withSite({ "index.html": page("x", block) }, (root) => {
    const result = audit(root, {});
    assert.equal(result.complete, true);
    assert.equal({}.polluted, undefined);
  });
});
