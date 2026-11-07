// Works out which selectors in the stylesheet files match something somewhere in the build,
// one page at a time, so no page has to stay in memory. A selector stops being checked as soon
// as it matches.

import { parseSelectorList, resolveNesting, selectorKey } from "./selectors.js";

// A selector that keeps failing against a very large number of elements counts as used, which
// means its declarations are checked as normal. That keeps hostile or extreme CSS from turning
// into an hours-long run, and the only cost is a possible report about CSS nothing uses.
const MAX_ELEMENT_CHECKS = 2_000_000;

export class SelectorUse {
  constructor(sheets) {
    // Selector list text to its parsed selectors. A list is in use when any of them is.
    this.lists = new Map();
    this.pending = new Map();
    this.checks = new Map();
    const add = (complex) => {
      if (complex.unparsed || complex.unknownPseudo) {
        // A selector this tool cannot read gets the benefit of the doubt.
        complex.used = true;
        return;
      }
      const key = selectorKey(complex);
      if (!this.pending.has(key)) this.pending.set(key, new Set());
      this.pending.get(key).add(complex);
    };
    for (const sheet of sheets) {
      for (const declaration of sheet.declarations) {
        if (declaration.selectorPath.length === 0) continue;
        const text = resolveNesting(declaration.selectorPath);
        if (this.lists.has(text)) continue;
        const parsed = parseSelectorList(text);
        this.lists.set(text, parsed);
        parsed.forEach(add);
      }
    }
  }

  visit(page) {
    const index = page.elementIndex;
    const keys = [...(this.pending.has(null) ? [null] : []), ...index.keys()];
    for (const key of keys) {
      const waiting = this.pending.get(key);
      if (!waiting) continue;
      const elementCount = key === null ? page.elements.length : index.get(key).length;
      for (const complex of waiting) {
        const spent = (this.checks.get(complex) ?? 0) + elementCount;
        this.checks.set(complex, spent);
        if (spent > MAX_ELEMENT_CHECKS || page.matching(complex, 1).length > 0) {
          complex.used = true;
          waiting.delete(complex);
          this.checks.delete(complex);
        }
      }
      if (waiting.size === 0) this.pending.delete(key);
    }
  }

  isUsed(text) {
    return (this.lists.get(text) ?? parseSelectorList(text)).some((complex) => complex.used === true);
  }
}
