// Character reference decoding for HTML text and attribute values.
//
// Copy rules have to see "&mdash;" and "&#8212;" as the same character as a literal
// em dash, and link rules have to see "&amp;" in a query string as "&". The table
// holds the references that show up in real pages; an unknown name stays as typed.

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  mdash: "\u2014", ndash: "\u2013", horbar: "\u2015", hyphen: "\u2010", dash: "\u2010",
  minus: "\u2212", shy: "\u00ad",
  hellip: "\u2026", mldr: "\u2026", middot: "\u00b7", centerdot: "\u00b7", bull: "\u2022", bullet: "\u2022",
  lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201a", ldquo: "\u201c", rdquo: "\u201d", bdquo: "\u201e",
  laquo: "\u00ab", raquo: "\u00bb", lsaquo: "\u2039", rsaquo: "\u203a",
  copy: "\u00a9", reg: "\u00ae", trade: "\u2122", deg: "\u00b0", para: "\u00b6", sect: "\u00a7",
  dagger: "\u2020", Dagger: "\u2021", prime: "\u2032", Prime: "\u2033",
  cent: "\u00a2", pound: "\u00a3", euro: "\u20ac", yen: "\u00a5", curren: "\u00a4",
  times: "\u00d7", divide: "\u00f7", plusmn: "\u00b1", frac12: "\u00bd", frac14: "\u00bc", frac34: "\u00be",
  sup1: "\u00b9", sup2: "\u00b2", sup3: "\u00b3", micro: "\u00b5", ordf: "\u00aa", ordm: "\u00ba",
  larr: "\u2190", uarr: "\u2191", rarr: "\u2192", darr: "\u2193", harr: "\u2194",
  check: "\u2713", cross: "\u2717", star: "\u2606", starf: "\u2605", hearts: "\u2665",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", zwnj: "\u200c", zwj: "\u200d",
  iexcl: "\u00a1", iquest: "\u00bf", szlig: "\u00df",
  agrave: "\u00e0", aacute: "\u00e1", acirc: "\u00e2", atilde: "\u00e3", auml: "\u00e4", aring: "\u00e5", aelig: "\u00e6",
  ccedil: "\u00e7", egrave: "\u00e8", eacute: "\u00e9", ecirc: "\u00ea", euml: "\u00eb",
  igrave: "\u00ec", iacute: "\u00ed", icirc: "\u00ee", iuml: "\u00ef", ntilde: "\u00f1",
  ograve: "\u00f2", oacute: "\u00f3", ocirc: "\u00f4", otilde: "\u00f5", ouml: "\u00f6", oslash: "\u00f8",
  ugrave: "\u00f9", uacute: "\u00fa", ucirc: "\u00fb", uuml: "\u00fc", yacute: "\u00fd", yuml: "\u00ff",
  Agrave: "\u00c0", Aacute: "\u00c1", Acirc: "\u00c2", Atilde: "\u00c3", Auml: "\u00c4", Aring: "\u00c5", AElig: "\u00c6",
  Ccedil: "\u00c7", Egrave: "\u00c8", Eacute: "\u00c9", Ecirc: "\u00ca", Euml: "\u00cb",
  Igrave: "\u00cc", Iacute: "\u00cd", Icirc: "\u00ce", Iuml: "\u00cf", Ntilde: "\u00d1",
  Ograve: "\u00d2", Oacute: "\u00d3", Ocirc: "\u00d4", Otilde: "\u00d5", Ouml: "\u00d6", Oslash: "\u00d8",
  Ugrave: "\u00d9", Uacute: "\u00da", Ucirc: "\u00db", Uuml: "\u00dc", Yacute: "\u00dd",
};

// These few may legally appear with no semicolon, so "&amp" and "&nbsp" decode too.
const NO_SEMICOLON = new Set(["amp", "lt", "gt", "quot", "nbsp", "copy", "reg"]);

// The HTML standard maps numeric references in this range to Windows-1252, which is
// how "&#151;" comes out as an em dash in a browser.
const WINDOWS_1252 = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const REFERENCE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*)(;?)/g;

function codePointToString(code) {
  const mapped = WINDOWS_1252[code] ?? code;
  if (mapped === 0 || mapped > 0x10ffff || (mapped >= 0xd800 && mapped <= 0xdfff)) return "\ufffd";
  return String.fromCodePoint(mapped);
}

// Returns the decoded text for one match, or null when it should stay literal.
function replacementFor(match, body, semicolon, nextChar, inAttribute) {
  if (body[0] === "#") {
    const isHex = body[1] === "x" || body[1] === "X";
    const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
    return codePointToString(code);
  }
  if (semicolon) {
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[body] : null;
  }
  if (!NO_SEMICOLON.has(body)) return null;
  // In an attribute "?a=1&copy=2" is a query string, not a copyright sign.
  if (inAttribute && nextChar !== undefined && /[=a-zA-Z0-9]/.test(nextChar)) return null;
  return NAMED[body];
}

export function decodeEntities(raw, { attribute = false } = {}) {
  if (!raw.includes("&")) return raw;
  return raw.replace(REFERENCE, (match, body, semicolon, offset) => {
    const next = raw[offset + match.length];
    const value = replacementFor(match, body, semicolon, next, attribute);
    return value === null ? match : value;
  });
}

// Maps an index in the decoded text back to its index in the raw source, so a finding
// can point at the exact "&mdash;" that produced a character.
export function rawIndexForDecoded(raw, decodedIndex) {
  let rawPos = 0;
  let decodedPos = 0;
  for (const match of raw.matchAll(REFERENCE)) {
    const literalLength = match.index - rawPos;
    if (decodedIndex < decodedPos + literalLength) {
      return rawPos + (decodedIndex - decodedPos);
    }
    decodedPos += literalLength;
    const next = raw[match.index + match[0].length];
    const value = replacementFor(match[0], match[1], match[2], next, false);
    const decoded = value === null ? match[0] : value;
    if (decodedIndex < decodedPos + decoded.length) return match.index;
    decodedPos += decoded.length;
    rawPos = match.index + match[0].length;
  }
  return rawPos + (decodedIndex - decodedPos);
}
