# Structured data

These rules read JSON-LD (JSON for Linked Data) blocks. A message names the node by its type and `name` or `headline`, then by its `@id`, or, without one, by where it sits in its block, such as `Offer at @graph[1].offers[0]`.

## Blocks and fields

| Rule | Default | Reports |
|---|---|---|
| `schema/invalid-json` | error | A JSON-LD block does not parse as JSON. |
| `schema/page-missing` | warning | An indexable page has no JSON-LD block. |
| `schema/missing-context` | error | A JSON-LD block has no schema.org `@context`. |
| `schema/unknown-context` | warning | A `@context` mentions schema.org but is not an address consumers recognize, such as `schema.org` with no scheme, `https://schema.org/Product`, or an `@vocab` without its final slash. |
| `schema/missing-type` | error | A JSON-LD node has no `@type`. A node holding only an `@id` is a reference and needs none. |
| `schema/required-field` | error | A node lacks a field its type cannot do without, or is a breadcrumb other than the last with no link. Empty values count as missing. |
| `schema/recommended-field` | warning | A node lacks a field that makes its type more useful to search and answer engines. Empty values count as missing. |
| `schema/required-type` | error | An indexable page lacks a type listed in `types`. The default list is empty, so this does nothing until configured. |
| `schema/faq-content` | warning | A page with question and answer content has no `FAQPage` or `QAPage` node. |
| `schema/blog-post-article` | warning | A page under a blog path has no `Article` node or subtype. |

Options:

- `schema/required-field`: `required` maps a type to its fields. `a|b` means either field, and `a.b` looks inside a nested object. It merges by key, so you can change one type alone. `standalone` maps a type to fields it needs only when it stands on its own, not inside or referenced from the thing it belongs to: a review on its own has to say what it reviews. `subtypes` maps a type to extra type names that count as it, beyond the built-in schema.org subtypes. A name placed there also counts as every type its parent counts as.

  | Type | Default required fields |
  |---|---|
  | LocalBusiness | name, address |
  | Service | name or serviceType |
  | FAQPage | mainEntity |
  | BreadcrumbList | itemListElement |
  | Article | headline |
  | SpeakableSpecification | cssSelector or xpath |
  | Question | name, acceptedAnswer or suggestedAnswer |
  | Answer | text |
  | ListItem | position, name or item.name |
  | Organization | name |
  | Person | name |
  | Place | name |
  | PostalAddress | at least one of streetAddress, addressLocality, addressRegion, postalCode, addressCountry, postOfficeBoxNumber |
  | WebSite | url |
  | ProfilePage | mainEntity |
  | QAPage | mainEntity |
  | Product | name, offers or review or aggregateRating |
  | Offer | price or priceSpecification.price or lowPrice (an AggregateOffer is an Offer that gives a range) |
  | AggregateOffer | lowPrice, priceCurrency |
  | Rating | ratingValue |
  | AggregateRating | ratingValue, ratingCount or reviewCount |
  | Review | author, reviewRating |
  | Event | name, startDate, location |
  | Recipe | name, image |
  | JobPosting | title, description, datePosted, hiringOrganization, jobLocation or jobLocationType |
  | VideoObject | name, thumbnailUrl, uploadDate |
  | ImageObject | contentUrl or url |
  | HowTo | name, step or recipeInstructions (a Recipe is a HowTo) |
  | HowToStep | text or itemListElement |
  | Course | name, description |
  | SoftwareApplication | name, offers.price or offers.lowPrice or offers.priceSpecification.price, aggregateRating or review |
  | Book | name, author |

  | Type | Default standalone fields |
  |---|---|
  | Review | itemReviewed |
  | AggregateRating | itemReviewed |

- `schema/recommended-field`: `recommended` and `subtypes` work the same way.

  | Type | Default recommended fields |
  |---|---|
  | LocalBusiness | geo, areaServed, openingHoursSpecification |
  | Service | provider |
  | Article | author, datePublished |
  | Person | url or sameAs |
  | WebSite | name |
  | Product | image, description |
  | Offer | priceCurrency or priceSpecification.priceCurrency, availability or offerCount |
  | AggregateOffer | highPrice, offerCount |
  | Event | endDate, eventStatus, image, description, offers, organizer |
  | Recipe | author, datePublished, description, recipeIngredient, totalTime, recipeYield |
  | JobPosting | validThrough, employmentType, baseSalary |
  | VideoObject | description, duration, contentUrl or embedUrl |
  | HowTo | totalTime |
  | Course | provider |
  | SoftwareApplication | applicationCategory, operatingSystem |
  | Book | url, workExample or isbn |

- `schema/required-type`: `types` is the list of types every indexable page must carry. `subtypes` works as above.
- `schema/faq-content`: `minQuestions` (default 3) is how many headings that are questions, each followed by content, make a page question and answer content. Headings that are only a link, as on a listing page, do not count.
- `schema/blog-post-article`: `paths` lists file globs for blog posts (default `blog/**`, `posts/**`, `articles/**`, `news/**`). `listingPaths` lists file globs for listing pages under them, which are not posts.

A type's list applies to its schema.org subtypes as well: a `Plumber` is held to the LocalBusiness fields and to those of Organization and Place, a `BlogPosting` to Article's, a `MusicEvent` to Event's and a `Recipe` to HowTo's. A node with several types is held to the list of each. One deliberate gap: `HowToStep` is not treated as a `ListItem`, because steps do not carry the position and name a breadcrumb entry needs.

Top-level nodes, `@graph` members and `mainEntity` are held to these requirements. Other nested nodes are often short references, so they are not, with two exceptions. Speakable objects, questions, answers, list items, postal addresses, ratings and how-to steps are checked wherever they sit, since they mean nothing unless complete. The `offers`, `review` and `aggregateRating` of a Product, SoftwareApplication, Recipe, Course or Book (and the `offers` of an AggregateOffer) are checked too, since those are what their rich results show, and so is a node such a field refers to by `@id`. The offers of a Service or the reviews of a LocalBusiness are not. A node that holds only an `@id` is a reference, and is never held to a list.

## Values

These read every node at any depth, since a wrong value is wrong wherever it sits.

| Rule | Default | Reports |
|---|---|---|
| `schema/invalid-date` | error | A date or date-time is not ISO 8601, such as `2026-05-01` or `2026-05-01T19:00:00-07:00`. A space instead of the `T`, and dates that do not exist such as `2026-02-30`, are named as such. |
| `schema/date-order` | error | A node ends before it starts: an `endDate` before its `startDate`, a `validThrough` before its `validFrom`, a `dateModified` before its `datePublished`, and the like. |
| `schema/invalid-duration` | error | A duration is not ISO 8601, such as `PT30M`, or a recipe or video time is written in months (`P30M` is 30 months). |
| `schema/relative-url` | warning | A URL that consumers need in full is relative, has no scheme, or is not an `http` or `https` address. |
| `schema/invalid-price` | error | A price is not a plain number (`4.50`, not `$4.50` or `4,50`), is negative, or a `lowPrice` is above its `highPrice`. |
| `schema/invalid-currency` | error | A currency is not an ISO 4217 code such as `USD`. Lowercase codes and symbols are named as such. |
| `schema/rating-range` | error | A `ratingValue`, `bestRating` or `worstRating` is not a number, the value lies outside the range, or the best is not above the worst. |
| `schema/invalid-enum` | error | A field that takes a schema.org enumeration holds something else, such as `"availability": "In Stock"`. The member name, its `https://schema.org/` or `http://schema.org/` URL, `schema:` form and an object with that `@id` are all accepted. |

Options:

- `schema/invalid-date`: `fields` lists the date fields (default `datePublished`, `dateModified`, `dateCreated`, `uploadDate`, `startDate`, `endDate`, `previousStartDate`, `datePosted`, `validFrom`, `validThrough`, `priceValidUntil`, `availabilityStarts`, `availabilityEnds`, `birthDate`, `deathDate`, `foundingDate`, `dissolutionDate`, `expires`). Any precision from a year to a fraction of a second is accepted. Numbers, such as a founding year written as `1999`, are left alone.
- `schema/date-order`: `pairs` lists `[start, end]` field pairs (default `startDate` and `endDate`, `validFrom` and `validThrough`, `availabilityStarts` and `availabilityEnds`, `datePublished` and `dateModified`, `dateCreated` and `dateModified`, `datePosted` and `validThrough`, `birthDate` and `deathDate`, `foundingDate` and `dissolutionDate`). A date means its whole day, so an event starting at 19:00 and ending on the same date is fine. When only one of the two values has a time zone, the end has to be more than 26 hours early, the widest gap two time zones can make, before it is reported.
- `schema/invalid-duration`: `fields` lists the duration fields (default `duration`, `totalTime`, `cookTime`, `prepTime`, `performTime`, `timeRequired`). The months check applies to a Recipe's times and a media object's `duration`. A bare number is reported, since it has no unit.
- `schema/relative-url`: `fields` lists the URL fields (default `url`, `image`, `logo`, `thumbnailUrl`, `contentUrl`, `embedUrl`, `sameAs`, `item`). A breadcrumb `item` given as an object is checked by its `@id`. Other `@id` values are names, not addresses, and are not checked.
- `schema/invalid-price`: `fields` lists the price fields (default `price`, `lowPrice`, `highPrice`, `minPrice`, `maxPrice`).
- `schema/invalid-currency`: `fields` lists the currency fields (default `priceCurrency`, `currency`, `salaryCurrency`). `extraCodes` adds codes to accept, such as a cryptocurrency your payment provider supports.
- `schema/rating-range`: `bestRating` (default 5) and `worstRating` (default 1) are the scale a rating uses when it does not give its own, as schema.org defines.
- `schema/invalid-enum`: `enumerations` maps a field to its members. It merges by key, so you can add a field or change one alone. The defaults cover `availability`, `eventStatus`, `eventAttendanceMode`, `itemCondition`, `dayOfWeek` and `returnPolicyCategory`. A value that differs from a member only in case or spacing gets a suggestion.
- `schema/unknown-context` has no options. `https://schema.org`, `http://schema.org`, either with a final slash or `www.`, and the published context file `https://schema.org/docs/jsonldcontext.jsonld` are recognized.

## The site and the graph

| Rule | Default | Reports |
|---|---|---|
| `schema/broken-url` | error | A URL in structured data points into the site but leads to nothing in the build, or differs only in letter case from a file. |
| `schema/unresolved-id` | warning | A reference (an object holding only an `@id`) names an `@id` with a fragment, or a blank node, that no node on the page defines. |
| `schema/conflicting-id` | error | One `@id` on a page names things of different kinds, such as an Organization and a WebSite, or gives two different values for one field. |
| `schema/breadcrumb-position` | error | The positions in a `BreadcrumbList` do not run 1, 2, 3 with no gaps or repeats, or one is not a whole number. |
| `schema/search-action` | error | A `SearchAction` has no URL template, its template has no placeholder such as `{search_term_string}`, its `query-input` is missing or names a different placeholder, or its search page is not in the build. |
| `schema/inconsistent-entity` | warning | An Organization or WebSite with the same `@id` gives a different name on different pages. Reported once per `@id`, on the first page in file order that disagrees with the first page to name it. |

Options:

- `schema/broken-url`: `fields` lists the URL fields checked against the build (default `url`, `image`, `logo`, `item`, `thumbnailUrl`, `contentUrl`). A URL is in the site when it is relative or names the site's own host, which comes from `site.url` or is inferred from the sitemap and canonical links. Without a known host, absolute URLs are left alone.
- `schema/conflicting-id`: `fields` lists the fields two definitions of one `@id` must agree on (default `name`, `url`). A trailing slash does not count as a difference. Kinds that combine, such as an Organization that is also a Place, or a Book that is also a Product, do not conflict, and nor do types this tool does not know.
- `schema/inconsistent-entity`: `types` lists the types compared across pages (default `Organization` and `WebSite`, with their subtypes). `fields` lists the fields that must agree (default `name`).

All JSON-LD blocks on a page count together, as search engines merge them by `@id`. One `@id` can be written in several ways: on the home page, `#org`, `/#org` and `https://example.com/#org` are the same node once the site's address is known. An `@id` without a fragment, such as a page's own address, names that page, and an `@id` on another host, such as an entry in a public knowledge base, names something that needs no definition here, so `schema/unresolved-id` checks neither. A reference to a node defined only on another page is reported, because search engines read each page alone.
