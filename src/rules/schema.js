// Rules about JSON-LD (JSON for Linked Data) structured data.

import { ancestors, isHeadingName, textContent } from "../html/tree.js";
import { isIndexable } from "../site/classify.js";
import { makeMatcher } from "../site/glob.js";
import { asArray, hasField, isObject, nodeTypes } from "../schema/jsonld.js";
import { isTypeOrSubtype } from "../schema/types.js";

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

// A member with only an @id is a reference to a node defined elsewhere.
function isReferenceOnly(object) {
  return Object.keys(object).every((key) => key === "@id");
}

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
  LocalBusiness: ["name", "geo", "areaServed", "openingHoursSpecification", "aggregateRating", "review", "hasCredential", "makesOffer"],
  Service: ["name|serviceType", "provider"],
  FAQPage: ["mainEntity"],
  BreadcrumbList: ["itemListElement"],
  Article: ["headline", "author", "datePublished"],
  SpeakableSpecification: ["cssSelector|xpath"],
  Question: ["name", "acceptedAnswer|suggestedAnswer"],
  Answer: ["text"],
  ListItem: ["position", "name|item.name"],
};

// A nested LocalBusiness is usually a short reference such as a Service provider, so most
// types are only held to their field list at the top level. These are building blocks of
// another type and have no meaning unless complete, wherever they sit.
const CHECKED_AT_ANY_DEPTH = new Set(["SpeakableSpecification", "Question", "Answer", "ListItem"]);

function describeNode(node, typeName) {
  const label = node.object.name ?? node.object.headline;
  return typeof label === "string" && label.trim() !== "" ? `${typeName} "${label.trim()}"` : typeName;
}

const requiredField = {
  id: "schema/required-field",
  severity: "error",
  description: "A JSON-LD node lacks a field its type requires. The field lists per type are configurable.",
  options: { required: DEFAULT_REQUIRED, subtypes: {} },
  page(page, { options, report }) {
    for (const block of page.jsonLd) {
      if (!block.ok) continue;
      for (const node of block.nodes) {
        for (const [parent, fields] of Object.entries(options.required)) {
          if (!node.primary && !CHECKED_AT_ANY_DEPTH.has(parent)) continue;
          const match = node.types.find((type) => isTypeOrSubtype(type, parent, options.subtypes));
          if (!match || !Array.isArray(fields)) continue;
          for (const field of fields) {
            if (hasField(node.object, field)) continue;
            const wanted = field.split("|").map((name) => `"${name}"`).join(" or ");
            report({ file: page.file, offset: block.offset, message: `${describeNode(node, match)} is missing ${wanted}` });
          }
        }
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

export const schemaRules = [invalidJson, pageMissing, missingContext, missingType, requiredField, requiredType, faqContent, blogPostArticle];
