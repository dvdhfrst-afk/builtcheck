// Rules about JSON-LD (JSON for Linked Data) structured data.

import { ancestors, isHeadingName, textContent } from "../html/tree.js";
import { isIndexable } from "../site/classify.js";
import { makeMatcher } from "../site/glob.js";
import { asArray, hasField, isObject, isReferenceOnly, nodeTypes, ownValue } from "../schema/jsonld.js";
import { idIndex, idKey } from "../schema/graph.js";
import { isTypeOrSubtype, matchesAny, typesConflict } from "../schema/types.js";
import { resolveReference } from "../site/urls.js";
import {
  contextProblems, currencyProblem, dateProblem, durationProblem, endsBeforeStart, enumerationProblem,
  numericValue, parseIsoDate, priceProblem,
} from "../schema/values.js";

const invalidJson = {
  id: "schema/invalid-json",
  severity: "error",
  description: "A JSON-LD block does not parse as JSON.",
  page(page, { report }) {
    for (const block of page.jsonLd) {
      if (!block.ok) {
        report({ file: page.file, offset: block.errorOffset, message: `JSON-LD block does not parse: ${block.reason}` });
      }
    }
  },
};

const pageMissing = {
  id: "schema/page-missing",
  severity: "warning",
  description: "An indexable page has no JSON-LD block.",
  page(page, { report }) {
    if (isIndexable(page) && page.jsonLd.length === 0) {
      report({ file: page.file, message: "Page has no JSON-LD structured data" });
    }
  },
};

function topLevelObjects(block) {
  return block.ok ? asArray(block.data).filter(isObject) : [];
}

const missingContext = {
  id: "schema/missing-context",
  severity: "error",
  description: "A JSON-LD block has no schema.org @context, so consumers cannot interpret it.",
  page(page, { report }) {
    for (const block of page.jsonLd) {
      for (const object of topLevelObjects(block)) {
        if (!JSON.stringify(object["@context"] ?? "").toLowerCase().includes("schema.org")) {
          report({ file: page.file, offset: block.offset, message: 'JSON-LD block has no schema.org "@context"' });
        }
      }
    }
  },
};

const missingType = {
  id: "schema/missing-type",
  severity: "error",
  description: "A JSON-LD node has no @type.",
  page(page, { report }) {
    for (const block of page.jsonLd) {
      for (const object of topLevelObjects(block)) {
        const members = object["@graph"] === undefined ? [object] : asArray(object["@graph"]).filter(isObject);
        for (const member of members) {
          if (nodeTypes(member).length === 0 && !isReferenceOnly(member)) {
            report({ file: page.file, offset: block.offset, message: 'JSON-LD node has no "@type"' });
          }
        }
      }
    }
  },
};

const DEFAULT_REQUIRED = {
  LocalBusiness: ["name", "address"],
  Service: ["name|serviceType"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
  Article: ["headline"],
  SpeakableSpecification: ["cssSelector|xpath"],
  Question: ["name", "acceptedAnswer|suggestedAnswer"],
  Answer: ["text"],
  ListItem: ["position", "name|item.name"],
  Organization: ["name"],
  Person: ["name"],
  Place: ["name"],
  PostalAddress: ["streetAddress|addressLocality|addressRegion|postalCode|addressCountry|postOfficeBoxNumber"],
  WebSite: ["url"],
  ProfilePage: ["mainEntity"],
  QAPage: ["mainEntity"],
  Product: ["name", "offers|review|aggregateRating"],
  // An AggregateOffer is an Offer that gives its price as a range.
  Offer: ["price|priceSpecification.price|lowPrice"],
  AggregateOffer: ["lowPrice", "priceCurrency"],
  Rating: ["ratingValue"],
  AggregateRating: ["ratingValue", "ratingCount|reviewCount"],
  Review: ["author", "reviewRating"],
  Event: ["name", "startDate", "location"],
  Recipe: ["name", "image"],
  JobPosting: ["title", "description", "datePosted", "hiringOrganization", "jobLocation|jobLocationType"],
  VideoObject: ["name", "thumbnailUrl", "uploadDate"],
  ImageObject: ["contentUrl|url"],
  // A Recipe is a HowTo that gives its steps as recipeInstructions.
  HowTo: ["name", "step|recipeInstructions"],
  HowToStep: ["text|itemListElement"],
  Course: ["name", "description"],
  SoftwareApplication: ["name", "offers.price|offers.lowPrice|offers.priceSpecification.price", "aggregateRating|review"],
  Book: ["name", "author"],
};

// A review or rating that is not part of the thing it rates has to say what that thing is.
const DEFAULT_STANDALONE = {
  Review: ["itemReviewed"],
  AggregateRating: ["itemReviewed"],
};

// A nested LocalBusiness is usually a short reference such as a Service provider, so most
// types are only held to their field list at the top level. These are building blocks of
// another type and have no meaning unless complete, wherever they sit.
const CHECKED_AT_ANY_DEPTH = new Set(["SpeakableSpecification", "Question", "Answer", "ListItem", "PostalAddress", "Rating", "HowToStep"]);

// The offers, ratings and reviews of these types are the data their rich results show, so they
// are held to their own field lists. Elsewhere, such as the offers of a Service, they are often
// a short description and are left alone.
const REVIEWED = ["Product", "SoftwareApplication", "Recipe", "Course", "Book"];
const PART_PARENTS = new Map([
  ["offers", ["Product", "SoftwareApplication", "Offer"]],
  ["aggregateRating", REVIEWED],
  ["review", REVIEWED],
  ["reviews", REVIEWED],
]);

// Nodes that are parts of a checked node, including nodes a part refers to by @id.
function partsOf(page, site, subtypes) {
  const parts = new Set();
  const referenced = new Set();
  // Nodes come parent first, so a parent's standing is known before its children are seen.
  for (const node of page.jsonLdNodes) {
    const { parent } = node;
    if (parent === null || !PART_PARENTS.has(node.key)) continue;
    if (!(parent.primary || parts.has(parent)) || !matchesAny(parent.types, PART_PARENTS.get(node.key), subtypes)) continue;
    parts.add(node);
    const id = node.object["@id"];
    if (isReferenceOnly(node.object) && typeof id === "string") referenced.add(idKey(id, page, site).key);
  }
  for (const key of referenced) {
    for (const definition of idIndex(page, site).definitions.get(key) ?? []) parts.add(definition);
  }
  return parts;
}

function describeNode(node, typeName) {
  const label = node.object.name ?? node.object.headline;
  return typeof label === "string" && label.trim() !== "" ? `${typeName} "${label.trim()}"` : typeName;
}

// Names a node by its type and label, then its @id or, failing that, where it sits in its block.
function nodeName(node, typeName = node.types[0] ?? "Untyped node") {
  const base = describeNode(node, typeName);
  const id = node.object["@id"];
  if (typeof id === "string" && id.trim() !== "") return `${base} (@id ${id.trim()})`;
  return node.path ? `${base} at ${node.path}` : base;
}

function shown(value) {
  const text = typeof value === "string" ? JSON.stringify(value.trim()) : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function reportMissingFields(page, block, node, lists, context) {
  if (isReferenceOnly(node.object)) return;
  const { subtypes, parts, report } = context;
  for (const [parent, fields] of Object.entries(lists)) {
    if (!node.primary && !parts.has(node) && !CHECKED_AT_ANY_DEPTH.has(parent)) continue;
    const match = node.types.find((type) => isTypeOrSubtype(type, parent, subtypes));
    if (!match || !Array.isArray(fields)) continue;
    for (const field of fields) {
      if (hasField(node.object, field)) continue;
      const wanted = field.split("|").map((name) => `"${name}"`).join(" or ");
      report({ file: page.file, offset: block.offset, message: `${nodeName(node, match)} is missing ${wanted}` });
    }
  }
}

const requiredField = {
  id: "schema/required-field",
  severity: "error",
  description: "A JSON-LD node lacks a field its type cannot do without. The field lists per type are configurable.",
  options: { required: DEFAULT_REQUIRED, standalone: DEFAULT_STANDALONE, subtypes: {} },
  page(page, { site, options, report }) {
    const parts = partsOf(page, site, options.subtypes);
    const context = { subtypes: options.subtypes, parts, report };
    for (const block of page.jsonLd) {
      if (!block.ok) continue;
      for (const node of block.nodes) {
        reportMissingFields(page, block, node, options.required, context);
        if (node.primary && !parts.has(node)) reportMissingFields(page, block, node, options.standalone, context);
        // Every breadcrumb except the last (the current page) must link somewhere.
        if (node.types.includes("BreadcrumbList")) {
          const items = asArray(node.object.itemListElement).filter(isObject);
          for (const item of items.slice(0, -1)) {
            if (!hasField(item, "item")) {
              const label = typeof item.name === "string" ? `ListItem "${item.name}"` : "ListItem";
              report({ file: page.file, offset: block.offset, message: `${label} is missing "item" (only the last breadcrumb may omit it)` });
            }
          }
        }
      }
    }
  },
};

const DEFAULT_RECOMMENDED = {
  LocalBusiness: ["geo", "areaServed", "openingHoursSpecification"],
  Service: ["provider"],
  Article: ["author", "datePublished"],
  Person: ["url|sameAs"],
  WebSite: ["name"],
  Product: ["image", "description"],
  // An AggregateOffer counts its offers instead of giving one availability.
  Offer: ["priceCurrency|priceSpecification.priceCurrency", "availability|offerCount"],
  AggregateOffer: ["highPrice", "offerCount"],
  Event: ["endDate", "eventStatus", "image", "description", "offers", "organizer"],
  // Its instructions are required through HowTo, of which a Recipe is a subtype.
  Recipe: ["author", "datePublished", "description", "recipeIngredient", "totalTime", "recipeYield"],
  JobPosting: ["validThrough", "employmentType", "baseSalary"],
  VideoObject: ["description", "duration", "contentUrl|embedUrl"],
  HowTo: ["totalTime"],
  Course: ["provider"],
  SoftwareApplication: ["applicationCategory", "operatingSystem"],
  Book: ["url", "workExample|isbn"],
};

const recommendedField = {
  id: "schema/recommended-field",
  severity: "warning",
  description: "A JSON-LD node lacks a field that makes its type more useful to search and answer engines. The field lists per type are configurable.",
  options: { recommended: DEFAULT_RECOMMENDED, subtypes: {} },
  page(page, { site, options, report }) {
    const context = { subtypes: options.subtypes, parts: partsOf(page, site, options.subtypes), report };
    for (const block of page.jsonLd) {
      if (!block.ok) continue;
      for (const node of block.nodes) reportMissingFields(page, block, node, options.recommended, context);
    }
  },
};

const requiredType = {
  id: "schema/required-type",
  severity: "error",
  description: "An indexable page lacks a JSON-LD type listed in the types option. The default list is empty.",
  options: { types: [], subtypes: {} },
  page(page, { options, report }) {
    if (options.types.length === 0 || !isIndexable(page)) return;
    const types = page.jsonLdNodes.flatMap((node) => node.types);
    for (const wanted of options.types) {
      const present = types.some((type) => isTypeOrSubtype(type, wanted, options.subtypes));
      if (!present) report({ file: page.file, message: `Page has no JSON-LD node of type ${wanted}` });
    }
  },
};

function hasType(page, parents) {
  return page.jsonLdNodes.some((node) => node.types.some((type) => parents.some((parent) => isTypeOrSubtype(type, parent))));
}

// A heading that is one big link is a card on a listing page, and the answer is elsewhere.
function isLinkOnly(element) {
  if (ancestors(element).some((parent) => parent.name === "a")) return true;
  const text = textContent(element);
  return element.children.some((child) => child.name === "a" && textContent(child) === text);
}

function questionElements(page) {
  return page.elements.filter((element) => {
    const isCandidate = (isHeadingName(element.name) && element.name !== "h1") || element.name === "summary" || element.name === "dt";
    return isCandidate && textContent(element).endsWith("?") && !isLinkOnly(element);
  });
}

const faqContent = {
  id: "schema/faq-content",
  severity: "warning",
  description: "A page with question and answer content carries no FAQPage or QAPage node.",
  options: { minQuestions: 3 },
  page(page, { options, report }) {
    if (!isIndexable(page) || hasType(page, ["FAQPage", "QAPage", "Article"])) return;
    const questions = questionElements(page);
    if (questions.length >= options.minQuestions) {
      report({
        file: page.file,
        offset: questions[0].start,
        message: `Page has ${questions.length} questions in headings or summaries but no FAQPage structured data`,
      });
    }
  },
};

const blogPostArticle = {
  id: "schema/blog-post-article",
  severity: "warning",
  description: "A blog post carries no Article node (or a subtype such as BlogPosting).",
  options: {
    paths: ["blog/**", "posts/**", "articles/**", "news/**"],
    listingPaths: [
      "*/index.html", "*/index.htm", "*/page/**", "*/tag/**", "*/tags/**", "*/category/**",
      "*/categories/**", "*/author/**", "*/authors/**", "*/archive/**",
    ],
  },
  page(page, { options, report }) {
    if (!isIndexable(page) || makeMatcher(options.listingPaths)(page.file)) return;
    const ogType = page.metaContent("og:type");
    const isPost = makeMatcher(options.paths)(page.file) || (ogType !== null && ogType.trim().toLowerCase() === "article");
    if (isPost && !hasType(page, ["Article"])) {
      report({ file: page.file, message: "Blog post has no Article structured data" });
    }
  },
};

// ---- Value checks. These read every node at any depth, since a wrong value is wrong wherever
// it sits, and each reports the node and field it found.

function okBlocks(page) {
  return page.jsonLd.filter((block) => block.ok);
}

// Calls fn(block, node, field, value) for each value of each named field, over every node.
function eachValue(page, fields, fn) {
  for (const block of okBlocks(page)) {
    for (const node of block.nodes) {
      for (const field of fields) {
        for (const value of asArray(ownValue(node.object, field))) fn(block, node, field, value);
      }
    }
  }
}

function isBlank(value) {
  return value === null || (typeof value === "string" && value.trim() === "");
}

const DATE_FIELDS = [
  "datePublished", "dateModified", "dateCreated", "uploadDate", "startDate", "endDate", "previousStartDate",
  "datePosted", "validFrom", "validThrough", "priceValidUntil", "availabilityStarts", "availabilityEnds",
  "birthDate", "deathDate", "foundingDate", "dissolutionDate", "expires",
];

const invalidDate = {
  id: "schema/invalid-date",
  severity: "error",
  description: "A date or date-time in JSON-LD is not in ISO 8601 form.",
  options: { fields: DATE_FIELDS },
  page(page, { options, report }) {
    eachValue(page, options.fields, (block, node, field, value) => {
      if (typeof value !== "string" || isBlank(value)) return;
      const problem = dateProblem(value);
      if (problem) report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(value)}, which ${problem}` });
    });
  },
};

const DEFAULT_PAIRS = [
  ["startDate", "endDate"], ["validFrom", "validThrough"], ["availabilityStarts", "availabilityEnds"],
  ["datePublished", "dateModified"], ["dateCreated", "dateModified"], ["datePosted", "validThrough"],
  ["birthDate", "deathDate"], ["foundingDate", "dissolutionDate"],
];

const dateOrder = {
  id: "schema/date-order",
  severity: "error",
  description: "A JSON-LD node ends before it starts, such as an event whose endDate is before its startDate.",
  options: { pairs: DEFAULT_PAIRS },
  validate(options) {
    if (!options.pairs.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((field) => typeof field === "string"))) {
      throw new Error('"pairs" must list pairs of field names, such as ["startDate", "endDate"]');
    }
  },
  page(page, { options, report }) {
    for (const block of okBlocks(page)) {
      for (const node of block.nodes) {
        for (const [startField, endField] of options.pairs) {
          const start = ownValue(node.object, startField);
          const end = ownValue(node.object, endField);
          if (typeof start !== "string" || typeof end !== "string") continue;
          const first = parseIsoDate(start.trim());
          const last = parseIsoDate(end.trim());
          if (first && last && endsBeforeStart(first, last)) {
            report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${endField}" ${shown(end)}, which is before its "${startField}" ${shown(start)}` });
          }
        }
      }
    }
  },
};

const RECIPE_TIMES = new Set(["cookTime", "prepTime", "performTime", "totalTime"]);

// Whether a field holds minutes or hours, where a duration in months is almost surely a typo.
function isShortDuration(node, field) {
  if (RECIPE_TIMES.has(field)) return matchesAny(node.types, ["Recipe"]);
  return field === "duration" && matchesAny(node.types, ["MediaObject"]);
}

const invalidDuration = {
  id: "schema/invalid-duration",
  severity: "error",
  description: "A duration in JSON-LD is not in ISO 8601 form, or a cooking or video time is written in months.",
  options: { fields: ["duration", "totalTime", "cookTime", "prepTime", "performTime", "timeRequired"] },
  page(page, { options, report }) {
    eachValue(page, options.fields, (block, node, field, value) => {
      let problem = null;
      if (typeof value === "number") problem = "is a bare number; write an ISO 8601 duration such as PT30M";
      else if (typeof value === "string" && !isBlank(value)) problem = durationProblem(value, isShortDuration(node, field));
      if (problem) report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(value)}, which ${problem}` });
    });
  },
};

// A breadcrumb's item is a URL, given as a string or as the @id of an object.
function urlValue(field, value) {
  if (typeof value === "string") return value.trim();
  if (field === "item" && isObject(value) && typeof value["@id"] === "string") return value["@id"].trim();
  return null;
}

const URL_SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

function absoluteUrlProblem(url) {
  const scheme = URL_SCHEME.exec(url);
  if (!scheme) {
    if (url.startsWith("//")) return "has no scheme; start it with https:";
    return "is a relative URL; consumers that read the data apart from the page cannot resolve it, so write the full address";
  }
  if (!/^https?$/i.test(scheme[1])) return "is not an http or https URL";
  try {
    new URL(url);
    return null;
  } catch {
    return "is not a valid URL";
  }
}

const relativeUrl = {
  id: "schema/relative-url",
  severity: "warning",
  description: "A URL in JSON-LD that consumers need in full is relative or not an http address.",
  options: { fields: ["url", "image", "logo", "thumbnailUrl", "contentUrl", "embedUrl", "sameAs", "item"] },
  page(page, { options, report }) {
    eachValue(page, options.fields, (block, node, field, value) => {
      const url = urlValue(field, value);
      if (url === null || url === "") return;
      const problem = absoluteUrlProblem(url);
      if (problem) report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(url)}, which ${problem}` });
    });
  },
};

const invalidPrice = {
  id: "schema/invalid-price",
  severity: "error",
  description: "A price in JSON-LD is not a plain number, or a price range runs backwards.",
  options: { fields: ["price", "lowPrice", "highPrice", "minPrice", "maxPrice"] },
  page(page, { options, report }) {
    eachValue(page, options.fields, (block, node, field, value) => {
      if (isBlank(value) || isObject(value)) return;
      const problem = priceProblem(value);
      if (problem) report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(value)}, which ${problem}` });
    });
    for (const block of okBlocks(page)) {
      for (const node of block.nodes) {
        for (const [lowField, highField] of [["lowPrice", "highPrice"], ["minPrice", "maxPrice"]]) {
          const low = numericValue(ownValue(node.object, lowField));
          const high = numericValue(ownValue(node.object, highField));
          if (low !== null && high !== null && low > high) {
            report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${lowField}" ${low} above its "${highField}" ${high}` });
          }
        }
      }
    }
  },
};

const invalidCurrency = {
  id: "schema/invalid-currency",
  severity: "error",
  description: "A currency in JSON-LD is not an ISO 4217 code.",
  options: { fields: ["priceCurrency", "currency", "salaryCurrency"], extraCodes: [] },
  page(page, { options, report }) {
    eachValue(page, options.fields, (block, node, field, value) => {
      if (isBlank(value) || isObject(value)) return;
      const problem = currencyProblem(value, options.extraCodes);
      if (problem) report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(value)}, which ${problem}` });
    });
  },
};

// A rating field that is present must be a number. Result: { value } or { problem }.
function ratingNumber(object, field, fallback) {
  const raw = ownValue(object, field);
  if (raw === undefined || isBlank(raw)) return { value: fallback, given: false };
  const value = numericValue(raw);
  if (value !== null) return { value, given: true };
  const hint = typeof raw === "string" && /^\d+,\d+$/.test(raw.trim()) ? "; use a dot for decimals" : "";
  return { problem: `has "${field}" ${shown(raw)}, which is not a number${hint}` };
}

const ratingRange = {
  id: "schema/rating-range",
  severity: "error",
  description: "A rating value is not a number or lies outside its bestRating and worstRating.",
  options: { bestRating: 5, worstRating: 1 },
  page(page, { options, report }) {
    for (const block of okBlocks(page)) {
      for (const node of block.nodes) {
        if (ownValue(node.object, "ratingValue") === undefined) continue;
        const rating = ratingNumber(node.object, "ratingValue", null);
        const best = ratingNumber(node.object, "bestRating", options.bestRating);
        const worst = ratingNumber(node.object, "worstRating", options.worstRating);
        const say = (text) => report({ file: page.file, offset: block.offset, message: `${nodeName(node)} ${text}` });
        const problem = [rating, best, worst].find((entry) => entry.problem);
        if (problem) {
          say(problem.problem);
        } else if (rating.value === null) {
          continue;
        } else if (best.value <= worst.value) {
          say(`has "bestRating" ${best.value}, which is not above its "worstRating" ${worst.value}`);
        } else if (rating.value < worst.value || rating.value > best.value) {
          const hint = best.given ? "" : `; set "bestRating" if the scale is not ${worst.value} to ${best.value}`;
          say(`has "ratingValue" ${rating.value}, outside its range of ${worst.value} to ${best.value}${hint}`);
        }
      }
    }
  },
};

const DEFAULT_ENUMERATIONS = {
  availability: [
    "BackOrder", "Discontinued", "InStock", "InStoreOnly", "LimitedAvailability", "MadeToOrder",
    "OnlineOnly", "OutOfStock", "PreOrder", "PreSale", "Reserved", "SoldOut",
  ],
  eventStatus: ["EventScheduled", "EventCancelled", "EventMovedOnline", "EventPostponed", "EventRescheduled"],
  eventAttendanceMode: ["OfflineEventAttendanceMode", "OnlineEventAttendanceMode", "MixedEventAttendanceMode"],
  itemCondition: ["NewCondition", "UsedCondition", "RefurbishedCondition", "DamagedCondition"],
  dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "PublicHolidays"],
  returnPolicyCategory: [
    "MerchantReturnFiniteReturnWindow", "MerchantReturnNotPermitted", "MerchantReturnUnlimitedWindow", "MerchantReturnUnspecified",
  ],
};

const invalidEnum = {
  id: "schema/invalid-enum",
  severity: "error",
  description: "A field that takes a schema.org enumeration, such as availability or eventStatus, holds something else.",
  options: { enumerations: DEFAULT_ENUMERATIONS },
  validate(options) {
    for (const [field, members] of Object.entries(options.enumerations)) {
      if (!Array.isArray(members) || !members.every((member) => typeof member === "string")) {
        throw new Error(`"enumerations.${field}" must be a list of member names`);
      }
    }
  },
  page(page, { options, report }) {
    const fields = Object.keys(options.enumerations);
    eachValue(page, fields, (block, node, field, value) => {
      if (isBlank(value)) return;
      const problem = enumerationProblem(value, options.enumerations[field]);
      if (problem) report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(value)}, which ${problem}` });
    });
  },
};

const unknownContext = {
  id: "schema/unknown-context",
  severity: "warning",
  description: "A JSON-LD @context mentions schema.org but is not one of the addresses consumers recognize.",
  page(page, { report }) {
    for (const block of page.jsonLd) {
      for (const object of topLevelObjects(block)) {
        for (const problem of contextProblems(ownValue(object, "@context"))) {
          report({ file: page.file, offset: block.offset, message: `JSON-LD ${problem}` });
        }
      }
    }
  },
};

// ---- Site-aware checks: what the structured data says about the build and about other nodes.

const brokenUrl = {
  id: "schema/broken-url",
  severity: "error",
  description: "A URL in JSON-LD points into the site but leads to nothing in the build.",
  options: { fields: ["url", "image", "logo", "item", "thumbnailUrl", "contentUrl"] },
  page(page, { site, options, report }) {
    eachValue(page, options.fields, (block, node, field, value) => {
      const url = urlValue(field, value);
      if (!url) return;
      const resolved = resolveReference(url, page.baseUrl, site);
      if (resolved.kind !== "internal" || site.lookup(resolved.path) !== null) return;
      const actual = site.caseMismatch(resolved.path);
      const why = actual ? `differs only in letter case from ${actual}, which breaks on case-sensitive hosts` : "leads to nothing in the build";
      report({ file: page.file, offset: block.offset, message: `${nodeName(node)} has "${field}" ${shown(url)}, which ${why}` });
    });
  },
};

const unresolvedId = {
  id: "schema/unresolved-id",
  severity: "warning",
  description: "A JSON-LD reference names an @id that no node on the page defines.",
  page(page, { site, report }) {
    const { definitions, references } = idIndex(page, site);
    for (const { node, id, key, local, fragment } of references) {
      if (!local || !fragment || definitions.has(key)) continue;
      report({
        file: page.file,
        offset: blockOf(page, node).offset,
        message: `${nodeName(node.parent)} has "${node.key}" pointing at @id ${id.trim()}, but no node on this page defines it. Search engines read one page at a time, so define it here too`,
      });
    }
  },
};

function scalarText(value) {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim().replace(/\/+$/, "") : null;
}

function conflictBetween(first, second, fields) {
  if (typesConflict(first.types, second.types)) return `is used for both ${first.types.join(", ")} and ${second.types.join(", ")}`;
  for (const field of fields) {
    const a = scalarText(ownValue(first.object, field));
    const b = scalarText(ownValue(second.object, field));
    if (a !== null && b !== null && a !== b) return `has two different "${field}" values: ${shown(a)} and ${shown(b)}`;
  }
  return null;
}

// The block a node came from, looked up through a map so many references stay cheap.
function blockOf(page, node) {
  const blocks = page.once("jsonLdBlockOf", () => {
    const map = new Map();
    for (const block of okBlocks(page)) for (const each of block.nodes) map.set(each, block);
    return map;
  });
  return blocks.get(node);
}

const conflictingId = {
  id: "schema/conflicting-id",
  severity: "error",
  description: "One @id names different things on the same page, so consumers merge them into one confused node.",
  options: { fields: ["name", "url"] },
  page(page, { site, options, report }) {
    for (const nodes of idIndex(page, site).definitions.values()) {
      if (nodes.length < 2) continue;
      for (const other of nodes.slice(1)) {
        const conflict = conflictBetween(nodes[0], other, options.fields);
        if (conflict === null) continue;
        report({ file: page.file, offset: blockOf(page, other).offset, message: `@id ${nodes[0].object["@id"].trim()} ${conflict} on this page` });
        break;
      }
    }
  },
};

const breadcrumbPosition = {
  id: "schema/breadcrumb-position",
  severity: "error",
  description: "The positions in a BreadcrumbList do not run 1, 2, 3 without gaps or repeats.",
  page(page, { report }) {
    for (const block of okBlocks(page)) {
      for (const node of block.nodes) {
        if (!node.types.some((type) => isTypeOrSubtype(type, "BreadcrumbList"))) continue;
        const raw = asArray(ownValue(node.object, "itemListElement")).filter(isObject).map((item) => ownValue(item, "position"));
        // A missing position is a required field, reported there.
        if (raw.length === 0 || raw.some((position) => position === undefined || isBlank(position))) continue;
        const say = (text) => report({ file: page.file, offset: block.offset, message: `${nodeName(node)} ${text}` });
        const positions = raw.map((position) => numericValue(position));
        const bad = raw.find((position, index) => positions[index] === null || !Number.isInteger(positions[index]));
        if (bad !== undefined) {
          say(`has "position" ${shown(bad)}, which is not a whole number`);
          continue;
        }
        const sorted = [...positions].sort((a, b) => a - b);
        if (sorted.some((position, index) => position !== index + 1)) {
          say(`has positions ${positions.join(", ")}; they must run from 1 to ${positions.length} with no gaps or repeats`);
        }
      }
    }
  },
};

const PLACEHOLDER = /\{([^{}]*)\}/g;

function searchTemplates(action) {
  return asArray(ownValue(action, "target"))
    .map((target) => (isObject(target) ? ownValue(target, "urlTemplate") : target))
    .filter((template) => typeof template === "string" && template.trim() !== "");
}

// The placeholder name a query-input names: "required name=search_term_string" or an object
// with valueName. Result: a name, "" when it names none, or null when there is no query-input.
function queryInputName(action) {
  const input = ownValue(action, "query-input");
  if (input === undefined) return null;
  if (isObject(input)) return typeof input.valueName === "string" ? input.valueName.trim() : "";
  if (typeof input !== "string") return "";
  return /(?:^|\s)name=(\S+)/.exec(input)?.[1] ?? "";
}

const searchAction = {
  id: "schema/search-action",
  severity: "error",
  description: "A SearchAction has no URL template with a placeholder, its query-input names a different placeholder, or its search page is not in the build.",
  page(page, { site, report }) {
    for (const block of okBlocks(page)) {
      for (const node of block.nodes) {
        if (!node.types.some((type) => isTypeOrSubtype(type, "SearchAction"))) continue;
        const say = (text) => report({ file: page.file, offset: block.offset, message: `${nodeName(node)} ${text}` });
        const templates = searchTemplates(node.object);
        if (templates.length === 0) {
          say('has no "target" URL template');
          continue;
        }
        const placeholders = templates.flatMap((template) => [...template.matchAll(PLACEHOLDER)].map((match) => match[1].trim()));
        if (placeholders.length === 0) say(`has "target" ${shown(templates[0])}, which has no placeholder such as {search_term_string}`);
        const name = queryInputName(node.object);
        if (name === null) say('has no "query-input", so consumers cannot tell which placeholder takes the search terms');
        else if (name === "") say('has a "query-input" that names no placeholder; write "required name=search_term_string"');
        else if (placeholders.length > 0 && !placeholders.includes(name)) {
          say(`has "query-input" naming ${name}, but its "target" has {${placeholders.join("}, {")}}`);
        }
        for (const template of templates) {
          // A placeholder in the path itself stands for many pages, so only the query form is checked.
          if (template.split(/[?#]/)[0].includes("{")) continue;
          const resolved = resolveReference(template.replace(PLACEHOLDER, "x"), page.baseUrl, site);
          if (resolved.kind === "internal" && site.lookup(resolved.path) === null) {
            say(`has "target" ${shown(template)}, whose search page ${resolved.path} is not in the build`);
          }
        }
      }
    }
  },
};

// What each @id said on the pages seen so far in this run, per site.
const entitiesBySite = new WeakMap();

const inconsistentEntity = {
  id: "schema/inconsistent-entity",
  severity: "warning",
  description: "An Organization or WebSite with the same @id has a different name on different pages. Reported once per @id.",
  options: { types: ["Organization", "WebSite"], fields: ["name"] },
  page(page, { site, options, report }) {
    if (!entitiesBySite.has(site)) entitiesBySite.set(site, new Map());
    const seen = entitiesBySite.get(site);
    for (const [key, nodes] of idIndex(page, site).definitions) {
      const node = nodes.find((candidate) => matchesAny(candidate.types, options.types));
      if (!node) continue;
      if (!seen.has(key)) seen.set(key, { values: new Map(), reported: false });
      const entry = seen.get(key);
      for (const field of options.fields) {
        const value = nodes.map((candidate) => scalarText(ownValue(candidate.object, field))).find((text) => text !== null);
        if (value === undefined) continue;
        const earlier = entry.values.get(field);
        if (!earlier) {
          entry.values.set(field, { value, file: page.file });
        } else if (earlier.value !== value && earlier.file !== page.file && !entry.reported) {
          entry.reported = true;
          report({
            file: page.file,
            offset: blockOf(page, node).offset,
            message: `${nodeName(node)} has "${field}" ${shown(value)} here, but ${shown(earlier.value)} on ${earlier.file}`,
          });
        }
      }
    }
  },
};

export const schemaRules = [
  invalidJson, pageMissing, missingContext, missingType, requiredField, recommendedField, requiredType, faqContent, blogPostArticle,
  invalidDate, dateOrder, invalidDuration, relativeUrl, invalidPrice, invalidCurrency, ratingRange, invalidEnum, unknownContext,
  brokenUrl, unresolvedId, conflictingId, breadcrumbPosition, searchAction, inconsistentEntity,
];
