// Checks on single structured data values: dates, durations, prices, currencies, enumeration
// members and @context spellings. Each check returns null for a good value, or the reason it is
// not, written to follow the field and value in a message.

const DATE_TIME = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)?)?)?)?$/;
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// Date.UTC reads years below 100 as 1900 and later, so the year is set separately.
function utc(year, month, day, hour, minute, second, millisecond) {
  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second, millisecond));
  date.setUTCFullYear(year);
  return date.getTime();
}

function zoneOffset(zone) {
  if (zone === undefined || zone === "Z") return { minutes: 0, valid: true };
  const hours = Number(zone.slice(1, 3));
  const minutes = zone.length > 3 ? Number(zone.slice(-2)) : 0;
  const sign = zone[0] === "-" ? -1 : 1;
  return { minutes: sign * (hours * 60 + minutes), valid: hours <= 14 && minutes < 60 };
}

// Parses an ISO 8601 date or date-time in the extended form schema.org uses, at any precision
// from a year down to a fraction of a second. Result: null when invalid, otherwise
// { first, last, zoned }: the earliest and latest instant the value can mean, in milliseconds.
// "2026-05-01" means the whole day, so it starts at midnight and ends just before the next one.
export function parseIsoDate(text) {
  const match = DATE_TIME.exec(text);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  const year = Number(y);
  const month = mo === undefined ? 1 : Number(mo);
  const day = d === undefined ? 1 : Number(d);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const hour = h === undefined ? 0 : Number(h);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = s === undefined ? 0 : Number(s);
  if (hour > 23 || minute > 59 || second > 60) return null;
  const offset = zoneOffset(zone);
  if (!offset.valid) return null;
  const millisecond = fraction === undefined ? 0 : Math.floor(Number(`0.${fraction}`) * 1000);
  const first = utc(year, month, day, hour, Math.min(minute, 59), Math.min(second, 59), millisecond) - offset.minutes * 60000;
  let span;
  if (mo === undefined) span = utc(year + 1, 1, 1, 0, 0, 0, 0) - utc(year, 1, 1, 0, 0, 0, 0);
  else if (d === undefined) span = daysInMonth(year, month) * DAY;
  else if (h === undefined) span = DAY;
  else if (s === undefined) span = 60000;
  else span = fraction === undefined ? 1000 : 1;
  return { first, last: first + span - 1, zoned: zone !== undefined };
}

export function dateProblem(text) {
  const value = text.trim();
  if (parseIsoDate(value) !== null) return null;
  if (/^\d{4}-\d{2}-\d{2}[ ]\d{2}:\d{2}/.test(value)) return "separates the date and time with a space instead of a T";
  if (DATE_TIME.test(value)) return "is not a real date or time";
  return "is not an ISO 8601 date such as 2026-05-01 or 2026-05-01T19:00:00-07:00";
}

// Whether `end` means a moment before `start`. Without time zones on both, the comparison
// allows the widest gap two time zones can have, so only a clear mistake is reported.
export function endsBeforeStart(start, end) {
  const margin = start.zoned === end.zoned ? 0 : 26 * HOUR;
  return end.last < start.first - margin;
}

const NUMBER = "\\d+(?:[.,]\\d+)?";
const DURATION = new RegExp(`^P(?!$)(?:${NUMBER}Y)?(?:${NUMBER}M)?(?:${NUMBER}W)?(?:${NUMBER}D)?(?:T(?!$)(?:${NUMBER}H)?(?:${NUMBER}M)?(?:${NUMBER}S)?)?$`);

// `short` marks a field that holds minutes or hours, such as a cooking time, where "P30M" is
// valid ISO 8601 but means 30 months.
export function durationProblem(text, short) {
  const value = text.trim();
  if (!DURATION.test(value)) return "is not an ISO 8601 duration such as PT30M or PT1H15M";
  if (short && /^P[^T]*M/.test(value) && !value.includes("T")) {
    const amount = /(\d+(?:[.,]\d+)?)M/.exec(value)[1];
    return `means ${amount} months; for ${amount} minutes write PT${amount}M`;
  }
  return null;
}

// A price is a plain number: digits with an optional dot and decimals, no currency or grouping.
export function priceProblem(value) {
  if (typeof value === "number") return value >= 0 ? null : "is negative";
  if (typeof value !== "string") return "is not a number";
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return null;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text) || /^\d+,\d{1,2}$/.test(text)) {
    return "uses a comma; write the number with a dot for decimals and no thousands separator";
  }
  if (/\d/.test(text)) return 'holds more than a number; give the currency in "priceCurrency" and the amount alone';
  return "is not a number";
}

export function numericValue(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim())) return Number(value);
  return null;
}

// Active ISO 4217 codes, including the funds and precious metal codes but not the test codes.
const CURRENCIES = new Set(`
AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BOV BRL BSD BTN BWP
BYN BZD CAD CDF CHE CHF CHW CLF CLP CNY COP COU CRC CUC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB
EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY
KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR
MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB
RWF SAR SBD SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD
TWD TZS UAH UGX USD USN UYI UYU UYW UZS VED VES VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG
XDR XOF XPD XPF XPT XSU XUA YER ZAR ZMW ZWG ZWL
`.trim().split(/\s+/));

const SYMBOLS = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };

export function currencyProblem(value, extraCodes) {
  if (typeof value !== "string") return "is not a currency code";
  const code = value.trim();
  if (CURRENCIES.has(code) || extraCodes.includes(code)) return null;
  if (CURRENCIES.has(code.toUpperCase())) return `is not in capitals; write ${code.toUpperCase()}`;
  if (Object.hasOwn(SYMBOLS, code)) return `is a symbol; write the ISO 4217 code, such as ${SYMBOLS[code]}`;
  return "is not an ISO 4217 currency code such as USD or EUR";
}

const SCHEMA_IRI = /^(?:https?:\/\/(?:www\.)?schema\.org\/|schema:)/i;

// An enumeration value may be the member name, its full schema.org URL, or a schema: name.
// Result: null when it is a member, otherwise the reason, with a guess when one is close.
export function enumerationProblem(value, members) {
  const raw = typeof value === "string" ? value : value?.["@id"];
  if (typeof raw !== "string") return "is not an enumeration value";
  const name = raw.trim().replace(SCHEMA_IRI, "");
  if (members.includes(name)) return null;
  const simplified = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const close = members.find((member) => member.toLowerCase() === simplified);
  const sample = members.slice(0, 3).join(", ");
  return close ? `is not a schema.org member; did you mean ${close}?` : `is not one of its schema.org members, such as ${sample}`;
}

const CONTEXT_URL = /^https?:\/\/(?:www\.)?schema\.org(?:\/|\/docs\/jsonldcontext\.json(?:ld)?)?$/i;
const VOCAB_URL = /^https?:\/\/(?:www\.)?schema\.org\/$/i;

// Problems with the schema.org parts of a @context, which may be a string, an object with
// @vocab, or an array of both. Parts that do not mention schema.org are some other vocabulary.
export function contextProblems(context) {
  const problems = [];
  for (const part of Array.isArray(context) ? context : [context]) {
    if (typeof part === "string" && /schema\.org/i.test(part) && !CONTEXT_URL.test(part.trim())) {
      problems.push(`"@context" ${JSON.stringify(part)} is not a schema.org address; write "https://schema.org"`);
    }
    if (part !== null && typeof part === "object" && !Array.isArray(part)) {
      const vocab = Object.hasOwn(part, "@vocab") ? part["@vocab"] : undefined;
      if (typeof vocab === "string" && /schema\.org/i.test(vocab) && !VOCAB_URL.test(vocab.trim())) {
        problems.push(`"@vocab" ${JSON.stringify(vocab)} is not the schema.org vocabulary; write "https://schema.org/" with its final slash`);
      }
    }
  }
  return problems;
}
