// Checks the two date formats feeds use: RFC 822 in RSS (with the four-digit years of RFC 1123
// and RFC 2822) and RFC 3339 in Atom. Each check returns null for a valid date, or the reason
// it is not one.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Zone names RFC 822 defines, plus UTC, which readers all accept although the RFC does not.
const RFC822 =
  /^(?:([a-z]{3})\s*,\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{2}|\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|ut|utc|gmt|[ecmp][sd]t|[a-ik-z])$/i;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/;

function daysIn(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function rangeProblem(year, month, day, hour, minute, second) {
  if (month < 0 || month > 11) return "has no such month";
  if (day < 1 || day > daysIn(year, month)) return "has no such day in that month";
  if (hour > 23 || minute > 59 || second > 60) return "has a time that does not exist";
  return null;
}

export const RFC822_EXAMPLE = "Wed, 02 Oct 2002 13:00:00 GMT";
export const RFC3339_EXAMPLE = "2002-10-02T13:00:00Z";

export function rfc822Problem(value) {
  const match = RFC822.exec(value.trim());
  if (!match) return `is not an RFC 822 date such as "${RFC822_EXAMPLE}"`;
  const [, weekday, dayText, monthText, yearText, hourText, minuteText, secondText = "0"] = match;
  const month = MONTHS.indexOf(monthText.toLowerCase());
  if (month === -1) return `is not an RFC 822 date such as "${RFC822_EXAMPLE}": ${monthText} is not a month`;
  let year = Number(yearText);
  // Two-digit years, as RFC 2822 reads them.
  if (yearText.length === 2) year += year < 50 ? 2000 : 1900;
  const day = Number(dayText);
  const range = rangeProblem(year, month, day, Number(hourText), Number(minuteText), Number(secondText));
  if (range) return range;
  if (weekday) {
    const index = WEEKDAYS.indexOf(weekday.toLowerCase());
    if (index === -1) return `is not an RFC 822 date such as "${RFC822_EXAMPLE}": ${weekday} is not a day of the week`;
    const actual = new Date(Date.UTC(year, month, day)).getUTCDay();
    if (actual !== index) return `says ${WEEKDAY_NAMES[index]}, but that date is a ${WEEKDAY_NAMES[actual]}`;
  }
  return null;
}

export function rfc3339Problem(value) {
  const match = RFC3339.exec(value.trim());
  if (!match) {
    if (RFC3339.test(value.trim().toUpperCase().replace(" ", "T"))) return `must separate date and time with an upper case T and write UTC as an upper case Z, as in "${RFC3339_EXAMPLE}"`;
    return `is not an RFC 3339 date such as "${RFC3339_EXAMPLE}"`;
  }
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const range = rangeProblem(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (range) return range;
  if (offsetHour !== undefined && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return "has a time zone offset that does not exist";
  return null;
}
