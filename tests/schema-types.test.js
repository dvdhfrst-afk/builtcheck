// Structured data field lists per type: the schema.org hierarchy behind them, which nodes are
// held to them, and how a node is named in the message.

import assert from "node:assert/strict";
import { test } from "node:test";
import { collectNodes } from "../src/schema/jsonld.js";
import { isTypeOrSubtype, typesConflict } from "../src/schema/types.js";
import { findingsFor, page } from "./helpers.js";

const ld = (object) => `<script type="application/ld+json">${JSON.stringify(object)}</script>`;
const context = { "@context": "https://schema.org" };
const messages = (found) => found.map((f) => f.message).sort();
const site = (...objects) => ({ "index.html": page("x", objects.map(ld).join("")) });
const required = (...objects) => messages(findingsFor(site(...objects), "schema/required-field"));
const recommended = (...objects) => messages(findingsFor(site(...objects), "schema/recommended-field"));

// ---- the hierarchy

test("subtypes follow chains through the hierarchy", () => {
  assert.ok(isTypeOrSubtype("Plumber", "LocalBusiness"));
  assert.ok(isTypeOrSubtype("Plumber", "Organization"));
  assert.ok(isTypeOrSubtype("Plumber", "Place"));
  assert.ok(isTypeOrSubtype("BlogPosting", "CreativeWork"));
  assert.ok(isTypeOrSubtype("Recipe", "HowTo"));
  assert.ok(isTypeOrSubtype("AggregateOffer", "Offer"));
  assert.ok(isTypeOrSubtype("EmployerAggregateRating", "Rating"));
  assert.ok(isTypeOrSubtype("MusicEvent", "Event"));
  assert.ok(isTypeOrSubtype("FAQPage", "WebPage"));
  assert.ok(isTypeOrSubtype("ImageGallery", "WebPage"));
  assert.ok(isTypeOrSubtype("MobileApplication", "SoftwareApplication"));
  assert.ok(isTypeOrSubtype("CollegeOrUniversity", "Place"), "a school is also a civic structure");
  assert.ok(!isTypeOrSubtype("Organization", "Plumber"));
  assert.ok(!isTypeOrSubtype("HowToStep", "ListItem"), "steps are deliberately not held to breadcrumb rules");
  assert.ok(!isTypeOrSubtype("constructor", "Organization"));
});

test("a type the user places under another counts as everything that one counts as", () => {
  const extra = { LocalBusiness: ["Vet"], Vet: ["ExoticVet"] };
  assert.ok(isTypeOrSubtype("Vet", "Organization", extra));
  assert.ok(isTypeOrSubtype("ExoticVet", "Place", extra));
  assert.ok(!isTypeOrSubtype("Vet", "Event", extra));
  const loop = { A: ["B"], B: ["A"] };
  assert.ok(!isTypeOrSubtype("A", "Organization", loop), "a loop in the user's map ends");
});

test("only types of different kinds conflict, and some kinds combine", () => {
  assert.ok(typesConflict(["Organization"], ["WebSite"]));
  assert.ok(typesConflict(["Person"], ["Organization"]));
  assert.ok(!typesConflict(["Organization"], ["Plumber"]));
  assert.ok(!typesConflict(["Organization"], ["Place"]), "a LocalBusiness is both");
  assert.ok(!typesConflict(["Book"], ["Product"]), "a book is often typed as a product too");
  assert.ok(!typesConflict(["Organization"], ["Brand"]), "unknown types never conflict");
  assert.ok(!typesConflict(["WebPage"], ["Article"]));
});

// ---- where nodes sit

test("each node records its parent, key and path", () => {
  const nodes = collectNodes({ "@graph": [{ "@type": "Product", offers: [{ "@type": "Offer" }, { "@type": "Offer", seller: { "@type": "Organization" } }] }] });
  assert.deepEqual(nodes.map((node) => node.path), ["", "@graph[0]", "@graph[0].offers[0]", "@graph[0].offers[1]", "@graph[0].offers[1].seller"]);
  assert.equal(nodes[2].parent, nodes[1]);
  assert.equal(nodes[2].key, "offers");
  assert.equal(nodes[1].parent, null, "graph members are top-level nodes");
  const list = collectNodes([{ "@type": "A" }, { "@type": "B" }]);
  assert.deepEqual(list.map((node) => node.path), ["[0]", "[1]"]);
});

// ---- new types and their fields

test("each new type is held to its required fields", () => {
  const cases = [
    [{ "@type": "Product", name: "Loaf" }, ['Product "Loaf" is missing "offers" or "review" or "aggregateRating"']],
    [{ "@type": "Event", name: "Tasting" }, ['Event "Tasting" is missing "location"', 'Event "Tasting" is missing "startDate"']],
    [{ "@type": "Organization" }, ['Organization is missing "name"']],
    [{ "@type": "Person", url: "https://example.com/jane/" }, ['Person is missing "name"']],
    [{ "@type": "WebSite", name: "Example Bakery" }, ['WebSite "Example Bakery" is missing "url"']],
    [{ "@type": "ProfilePage", name: "Jane" }, ['ProfilePage "Jane" is missing "mainEntity"']],
    [{ "@type": "Recipe", name: "Rye" }, ['Recipe "Rye" is missing "image"', 'Recipe "Rye" is missing "step" or "recipeInstructions"']],
    [{ "@type": "JobPosting", title: "Baker", description: "Bake.", datePosted: "2026-01-02", hiringOrganization: { "@type": "Organization", name: "Example Bakery" } }, ['JobPosting is missing "jobLocation" or "jobLocationType"']],
    [{ "@type": "VideoObject", name: "Kneading" }, ['VideoObject "Kneading" is missing "thumbnailUrl"', 'VideoObject "Kneading" is missing "uploadDate"']],
    [{ "@type": "ImageObject", caption: "A loaf" }, ['ImageObject is missing "contentUrl" or "url"']],
    [{ "@type": "HowTo", name: "Shape a loaf" }, ['HowTo "Shape a loaf" is missing "step" or "recipeInstructions"']],
    [{ "@type": "Course", name: "Bread 101" }, ['Course "Bread 101" is missing "description"']],
    [{ "@type": "Book", name: "Crumb" }, ['Book "Crumb" is missing "author"']],
    [{ "@type": "TouristAttraction" }, ['TouristAttraction is missing "name"']],
    [{ "@type": "AggregateOffer", lowPrice: 5 }, ['AggregateOffer is missing "priceCurrency"']],
  ];
  for (const [object, expected] of cases) {
    assert.deepEqual(required({ ...context, ...object }), expected, JSON.stringify(object));
  }
});

test("complete nodes of the new types are quiet", () => {
  const nodes = [
    { "@type": "Product", name: "Loaf", offers: { "@type": "Offer", price: "4.50", priceCurrency: "USD" } },
    { "@type": "Event", name: "Tasting", startDate: "2026-05-01T18:00:00-07:00", location: { "@type": "VirtualLocation", url: "https://example.com/live/" } },
    { "@type": "Recipe", name: "Rye", image: "https://example.com/rye.jpg", recipeInstructions: [{ "@type": "HowToStep", text: "Mix." }] },
    { "@type": "SoftwareApplication", name: "Timer", offers: { "@type": "Offer", price: 0, priceCurrency: "USD" }, aggregateRating: { "@type": "AggregateRating", ratingValue: 4.5, ratingCount: 8 } },
    { "@type": "VideoObject", name: "Kneading", thumbnailUrl: "https://example.com/k.jpg", uploadDate: "2026-01-02" },
    { "@type": "JobPosting", title: "Baker", description: "Bake.", datePosted: "2026-01-02", hiringOrganization: { "@type": "Organization", name: "Example Bakery" }, jobLocationType: "TELECOMMUTE" },
  ];
  assert.deepEqual(required({ ...context, "@graph": nodes }), []);
});

test("a Recipe is a HowTo, and gives its steps as recipeInstructions", () => {
  const recipe = { ...context, "@type": "Recipe", name: "Rye", image: "https://example.com/rye.jpg", recipeInstructions: "Mix and bake." };
  assert.deepEqual(required(recipe), []);
  assert.deepEqual(recommended({ ...recipe, totalTime: "PT2H" }), [
    'Recipe "Rye" is missing "author"', 'Recipe "Rye" is missing "datePublished"', 'Recipe "Rye" is missing "description"',
    'Recipe "Rye" is missing "recipeIngredient"', 'Recipe "Rye" is missing "recipeYield"',
  ]);
});

test("recommended fields of the new types", () => {
  assert.deepEqual(recommended({ ...context, "@type": "WebSite", url: "https://example.com/" }), ['WebSite is missing "name"']);
  assert.deepEqual(recommended({ ...context, "@type": "Person", name: "Jane Doe" }), ['Person "Jane Doe" is missing "url" or "sameAs"']);
  assert.deepEqual(recommended({ ...context, "@type": "MusicEvent", name: "Gig", eventStatus: "EventScheduled", image: "i", description: "d", offers: { "@type": "Offer", price: 5 }, organizer: { "@type": "Organization", name: "O" } }), ['MusicEvent "Gig" is missing "endDate"']);
  assert.deepEqual(recommended({ ...context, "@type": "SoftwareApplication", name: "Timer", applicationCategory: "UtilitiesApplication" }), ['SoftwareApplication "Timer" is missing "operatingSystem"']);
});

test("an Organization or Place adds no recommendations to the LocalBusiness rules", () => {
  // LocalBusiness is an Organization and a Place, and its own list is what applies in practice.
  assert.equal(recommended({ ...context, "@type": "Plumber", name: "N" }).length, 3);
});

// ---- parts of a node

test("a product's offers, reviews and ratings are held to their own fields", () => {
  const product = {
    ...context,
    "@type": "Product",
    name: "Loaf",
    offers: [{ "@type": "Offer", priceCurrency: "USD" }, { "@type": "AggregateOffer", lowPrice: 3, priceCurrency: "USD", offers: { "@type": "Offer", availability: "InStock" } }],
    review: { "@type": "Review", author: { "@type": "Person", name: "Jane Doe" } },
    aggregateRating: { "@type": "AggregateRating", ratingValue: 4 },
  };
  assert.deepEqual(required(product), [
    'AggregateRating at aggregateRating is missing "ratingCount" or "reviewCount"',
    'Offer at offers[0] is missing "price" or "priceSpecification.price" or "lowPrice"',
    'Offer at offers[1].offers is missing "price" or "priceSpecification.price" or "lowPrice"',
    'Review at review is missing "reviewRating"',
  ]);
});

test("the offers and reviews of other types are not held to those fields", () => {
  const business = {
    ...context,
    "@type": "Plumber",
    name: "Example Plumbing",
    address: { "@type": "PostalAddress", addressLocality: "Sampleville" },
    makesOffer: { "@type": "Offer", itemOffered: { "@type": "Service", name: "Drains" } },
    review: { "@type": "Review", author: "Jane Doe" },
  };
  assert.deepEqual(required(business), []);
  const service = { ...context, "@type": "Service", name: "Drains", offers: { "@type": "Offer", itemOffered: "Drains" } };
  assert.deepEqual(required(service), []);
});

test("a review on its own must say what it reviews, and one inside or referenced by a product need not", () => {
  const rating = { "@type": "Rating", ratingValue: 5 };
  const alone = { ...context, "@type": "Review", author: "Jane Doe", reviewRating: rating };
  assert.deepEqual(required(alone), ['Review is missing "itemReviewed"']);
  const nested = { ...context, "@type": "Product", name: "Loaf", review: { "@type": "Review", author: "Jane Doe", reviewRating: rating } };
  assert.deepEqual(required(nested), []);
  const graph = {
    ...context,
    "@graph": [
      { "@type": "Product", name: "Loaf", review: { "@id": "#review-1" } },
      { "@type": "Review", "@id": "#review-1", author: "Jane Doe", reviewRating: rating },
    ],
  };
  assert.deepEqual(required(graph), []);
  const unrelated = { ...context, "@graph": [{ "@type": "WebPage", name: "W", about: { "@id": "#review-1" } }, { "@type": "Review", "@id": "#review-1", author: "Jane Doe", reviewRating: rating }] };
  assert.deepEqual(required(unrelated), ['Review (@id #review-1) is missing "itemReviewed"']);
});

test("the standalone list is configurable", () => {
  const files = site({ ...context, "@type": "Review", author: "Jane Doe", reviewRating: { "@type": "Rating", ratingValue: 4 } });
  const config = { rules: { "schema/required-field": { standalone: { Review: [] } } } };
  assert.deepEqual(findingsFor(files, "schema/required-field", config), []);
});

test("ratings, addresses and steps are checked wherever they sit", () => {
  const business = {
    ...context,
    "@type": "Plumber",
    name: "N",
    address: { "@type": "PostalAddress", name: "Head office" },
    aggregateRating: { "@type": "AggregateRating", reviewCount: 3 },
  };
  assert.deepEqual(required(business), [
    'AggregateRating at aggregateRating is missing "ratingValue"',
    'PostalAddress "Head office" at address is missing "streetAddress" or "addressLocality" or "addressRegion" or "postalCode" or "addressCountry" or "postOfficeBoxNumber"',
  ]);
  const recipe = { ...context, "@type": "Recipe", name: "Rye", image: "i", recipeInstructions: [{ "@type": "HowToStep", text: "Mix." }, { "@type": "HowToStep", name: "Bake" }] };
  assert.deepEqual(required(recipe), ['HowToStep "Bake" at recipeInstructions[1] is missing "text" or "itemListElement"']);
});

test("a reference is never held to the fields of the type it implies", () => {
  const question = { ...context, "@type": "FAQPage", mainEntity: { "@type": "Question", name: "Q?", acceptedAnswer: { "@id": "#answer" } } };
  assert.deepEqual(required(question), []);
});

test("arrays of types are checked against every type they name", () => {
  const both = { ...context, "@type": ["Book", "Product"], name: "Crumb" };
  assert.deepEqual(required(both), ['Book "Crumb" is missing "author"', 'Product "Crumb" is missing "offers" or "review" or "aggregateRating"']);
});

test("a node is named by its @id when it has one, otherwise by where it sits", () => {
  const graph = { ...context, "@graph": [{ "@type": "Organization", "@id": "https://example.com/#org" }, { "@type": "Event", name: "Tasting", startDate: "2026-05-01" }] };
  assert.deepEqual(required(graph), ['Event "Tasting" at @graph[1] is missing "location"', 'Organization (@id https://example.com/#org) is missing "name"']);
});

test("the new types are configurable like the old ones", () => {
  const files = site({ ...context, "@type": "MusicEvent", name: "Gig", startDate: "2026-05-01", location: "Hall" });
  const config = { rules: { "schema/required-field": { required: { Event: ["name", "performer"] } } } };
  assert.deepEqual(messages(findingsFor(files, "schema/required-field", config)), ['MusicEvent "Gig" is missing "performer"']);
});

test("a typical CMS graph is quiet", () => {
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": "https://example.com/blog/rye/#article",
        isPartOf: { "@id": "https://example.com/blog/rye/" },
        author: { "@id": "https://example.com/#/schema/person/1" },
        headline: "Rye",
        datePublished: "2026-01-02T10:00:00+00:00",
        dateModified: "2026-01-03T10:00:00+00:00",
        mainEntityOfPage: { "@id": "https://example.com/blog/rye/" },
        publisher: { "@id": "https://example.com/#organization" },
        image: { "@id": "https://example.com/blog/rye/#primaryimage" },
      },
      { "@type": "WebPage", "@id": "https://example.com/blog/rye/", url: "https://example.com/blog/rye/", name: "Rye", isPartOf: { "@id": "https://example.com/#website" }, breadcrumb: { "@id": "https://example.com/blog/rye/#breadcrumb" } },
      { "@type": "ImageObject", "@id": "https://example.com/blog/rye/#primaryimage", url: "https://example.com/rye.png", contentUrl: "https://example.com/rye.png", width: 1200, height: 630 },
      { "@type": "BreadcrumbList", "@id": "https://example.com/blog/rye/#breadcrumb", itemListElement: [{ "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" }, { "@type": "ListItem", position: 2, name: "Rye" }] },
      {
        "@type": "WebSite",
        "@id": "https://example.com/#website",
        url: "https://example.com/",
        name: "Example Bakery",
        publisher: { "@id": "https://example.com/#organization" },
        potentialAction: [{ "@type": "SearchAction", target: { "@type": "EntryPoint", urlTemplate: "https://example.com/?s={search_term_string}" }, "query-input": { "@type": "PropertyValueSpecification", valueRequired: true, valueName: "search_term_string" } }],
      },
      { "@type": "Organization", "@id": "https://example.com/#organization", name: "Example Bakery", url: "https://example.com/", logo: { "@type": "ImageObject", "@id": "https://example.com/#/schema/logo/image/", url: "https://example.com/logo.png", contentUrl: "https://example.com/logo.png" }, sameAs: ["https://social.example.org/examplebakery"] },
      { "@type": "Person", "@id": "https://example.com/#/schema/person/1", name: "Jane Doe", url: "https://example.com/author/jane/" },
    ],
  };
  const files = {
    "index.html": page("home"),
    "blog/rye/index.html": page("x", ld(graph)),
    "author/jane/index.html": page("jane"),
    "rye.png": "png",
    "logo.png": "png",
  };
  const config = { site: { url: "https://example.com" } };
  const found = findingsFor(files, "schema/*", { ...config, rules: { "schema/page-missing": "off" } });
  assert.deepEqual(found.map((f) => `${f.rule}: ${f.message}`), []);
});
