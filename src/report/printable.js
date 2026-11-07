// Messages and file names come from the audited files, which may be hostile. In a terminal or a
// CI log, control characters could move the cursor, hide lines or inject commands, and direction
// overrides could make text read differently from what it is. Each is shown as an escape instead.

const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g;

export function printable(text) {
  return String(text).replace(UNPRINTABLE, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
