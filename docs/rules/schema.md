# Structured data

| Rule | Default | Reports |
|---|---|---|
| `schema/invalid-json` | error | A JSON-LD block does not parse as JSON. |
| `schema/page-missing` | warning | An indexable page has no JSON-LD block. |
| `schema/missing-context` | error | A JSON-LD block has no schema.org `@context`. |
| `schema/missing-type` | error | A JSON-LD node has no `@type`. A node holding only an `@id` is a reference and needs none. |
| `schema/required-field` | error | A node lacks a field its type cannot do without, or is a breadcrumb other than the last with no link. Empty values count as missing. |
| `schema/recommended-field` | warning | A node lacks a field that makes its type more useful to search and answer engines. Empty values count as missing. |
| `schema/required-type` | error | An indexable page lacks a type listed in `types`. The default list is empty, so this does nothing until configured. |
| `schema/faq-content` | warning | A page with question and answer content has no `FAQPage` or `QAPage` node. |
| `schema/blog-post-article` | warning | A page under a blog path has no `Article` node or subtype. |

Options:

- `schema/required-field`: `required` maps a type to its fields. `a|b` means either field, and `a.b` looks inside a nested object. It merges by key, so you can change one type alone. `subtypes` maps a type to extra type names that count as it, beyond the built-in schema.org subtypes.

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

- `schema/recommended-field`: `recommended` and `subtypes` work the same way.

  | Type | Default recommended fields |
  |---|---|
  | LocalBusiness | geo, areaServed, openingHoursSpecification |
  | Service | provider |
  | Article | author, datePublished |

- `schema/required-type`: `types` is the list of types every indexable page must carry. `subtypes` works as above.
- `schema/faq-content`: `minQuestions` (default 3) is how many headings that are questions, each followed by content, make a page question and answer content. Headings that are only a link, as on a listing page, do not count.
- `schema/blog-post-article`: `paths` lists file globs for blog posts (default `blog/**`, `posts/**`, `articles/**`, `news/**`). `listingPaths` lists file globs for listing pages under them, which are not posts.

Top-level nodes, `@graph` members and `mainEntity` are held to these requirements. Other nested nodes are often short references, so they are not, except speakable and answer objects, whose type is implied by where they sit.
