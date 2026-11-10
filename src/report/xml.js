// Escaping for the XML formats. XML 1.0 cannot hold most control characters at all, not even as
// character references, and a reader stops at the first one, so those are written as a visible
// \u escape instead, as printable() does for a terminal. Lone surrogates are not characters either.

const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

const visible = (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;

export function xmlText(text) {
  return String(text)
    .replace(NOT_XML, visible)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // A reader turns a bare carriage return into a line feed.
    .replace(/\r/g, "&#13;");
}

// Inside an attribute a reader also turns tabs and line breaks into spaces, unless they are
// written as references.
export function xmlAttribute(text) {
  return xmlText(text).replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\t/g, "&#9;").replace(/\n/g, "&#10;");
}

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
