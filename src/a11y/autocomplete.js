// The grammar of the HTML autocomplete attribute on form controls, which lets browsers and
// assistive technology fill in and announce a field's purpose:
//
//   "on" | "off" | [section-*] [shipping | billing] [home | work | mobile | fax | pager] field [webauthn]
//
// where the home/work/mobile/fax/pager hint goes only with a contact field such as "tel".

const FIELDS = new Set([
  "name", "honorific-prefix", "given-name", "additional-name", "family-name", "honorific-suffix",
  "nickname", "username", "new-password", "current-password", "one-time-code",
  "organization-title", "organization", "street-address", "address-line1", "address-line2",
  "address-line3", "address-level4", "address-level3", "address-level2", "address-level1",
  "country", "country-name", "postal-code", "cc-name", "cc-given-name", "cc-additional-name",
  "cc-family-name", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-type",
  "transaction-currency", "transaction-amount", "language", "bday", "bday-day", "bday-month",
  "bday-year", "sex", "url", "photo",
]);

const CONTACT_FIELDS = new Set([
  "tel", "tel-country-code", "tel-national", "tel-area-code", "tel-local", "tel-local-prefix",
  "tel-local-suffix", "tel-extension", "email", "impp",
]);

const CONTACT_HINTS = new Set(["home", "work", "mobile", "fax", "pager"]);

// Why a value is not valid, or null when it is. Tokens compare without regard to letter case.
export function autocompleteProblem(value) {
  const words = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  if (words.length === 1 && (words[0] === "on" || words[0] === "off")) return null;
  if (words.includes("on") || words.includes("off")) return `"on" and "off" must stand alone`;
  let i = 0;
  if (words[i].startsWith("section-") && words[i].length > "section-".length) i += 1;
  if (words[i] === "shipping" || words[i] === "billing") i += 1;
  let hint = null;
  if (CONTACT_HINTS.has(words[i])) {
    hint = words[i];
    i += 1;
  }
  const field = words[i];
  if (field === undefined) return "it names no field, such as \"email\" or \"street-address\"";
  if (hint !== null && !CONTACT_FIELDS.has(field)) {
    return FIELDS.has(field) ? `"${hint}" goes only with a contact field such as "tel" or "email", not "${field}"` : `"${field}" is not an autocomplete field name`;
  }
  if (!FIELDS.has(field) && !CONTACT_FIELDS.has(field)) {
    if (words.slice(i + 1).some((word) => FIELDS.has(word) || CONTACT_FIELDS.has(word))) return `"${field}" is out of order or not an autocomplete token`;
    return `"${field}" is not an autocomplete field name`;
  }
  i += 1;
  if (words[i] === "webauthn") i += 1;
  if (i < words.length) return `"${words[i]}" cannot follow the field name "${field}"`;
  return null;
}
