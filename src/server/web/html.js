// HTML built from templates in which every value is escaped unless it is already HTML. File
// names, messages and labels come from audited sites and may be hostile, so the page never puts
// text into the document any other way. Used in the browser and by the server's page.

import { printable } from "../../report/printable.js";

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// A piece of HTML that is already safe: the result of html``, or text escaped by hand.
export class Html {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }
}

// Marks text as HTML. Only for markup this code wrote, never for anything from a site.
export function raw(text) {
  return new Html(text);
}

// Text escaped, with control characters and direction overrides shown as escapes, so a message
// cannot make the page read differently from what it says. Arrays are joined, and null,
// undefined and false leave nothing.
function part(value) {
  if (value instanceof Html) return value.text;
  if (Array.isArray(value)) return value.map(part).join("");
  if (value === null || value === undefined || value === false) return "";
  return escapeHtml(printable(value));
}

// html`<p>${message}</p>`: every value is escaped, wherever in the markup it appears, so values
// in attributes must still be quoted.
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += part(value) + strings[index + 1];
  });
  return new Html(out);
}
