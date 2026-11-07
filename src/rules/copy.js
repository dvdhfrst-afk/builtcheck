// Rules about the words on the page: dashes, duplicated headings and leftover placeholders.

import { hiddenByClass, isInsideHidden } from "../html/page.js";
import { rawIndexMapper } from "../html/entities.js";
import { ancestors, normalizeSpace, textContent } from "../html/tree.js";

function snippet(text, index, length) {
  const before = text.slice(Math.max(0, index - 30), index);
  const after = text.slice(index + length, index + length + 30);
  return normalizeSpace(`${before}${text.slice(index, index + length)}${after}`);
}

function offsetInRun(run, decodedIndex) {
  run.toRaw ??= rawIndexMapper(run.raw);
  return run.start + run.toRaw(decodedIndex);
}

const CHARACTER_NAMES = { "\u2014": "Em dash", "\u2013": "En dash", "\u2015": "Horizontal bar" };

const emDash = {
  id: "copy/em-dash",
  severity: "warning",
  description: "An em dash in visible text. Code, attributes and scripts are not checked. The characters option sets what counts.",
  options: { characters: ["\u2014"] },
  page(page, { options, report }) {
    for (const run of page.textRuns) {
      for (const character of options.characters) {
        const name = CHARACTER_NAMES[character] ?? `Character U+${character.codePointAt(0).toString(16).toUpperCase()}`;
        let at = run.value.indexOf(character);
        while (at !== -1) {
          report({
            file: page.file,
            offset: offsetInRun(run, at),
            message: `${name} in visible text: "${snippet(run.value, at, character.length)}"`,
          });
          at = run.value.indexOf(character, at + character.length);
        }
      }
    }
  },
};

// Exactly two hyphens. Longer runs are dividers and arrows are arrows.
const DOUBLE_HYPHEN = /(?<![-<])--(?![->])/g;

// Hyphens inside a URL, a domain or a file name are part of the name.
function isInsideTechnicalName(text, index) {
  // A long enough window to hold any real name, so a long text stays linear.
  const before = text.slice(Math.max(0, index - 256), index).split(/\s/).pop();
  const after = text.slice(index, index + 256).split(/\s/)[0];
  const token = `${before}${after}`.replace(/[.,;:!?)\]]+$/, "");
  return /:\/\/|^www\.|^xn--|\/|@|_/i.test(token) || /[\w-]\.[a-z][a-z0-9]{0,7}$/i.test(token);
}

const doubleHyphen = {
  id: "copy/double-hyphen",
  severity: "warning",
  description: 'A "--" standing in for a dash in visible text. Command line flags such as "--verbose" are not reported.',
  page(page, { report }) {
    for (const run of page.textRuns) {
      for (const match of run.value.matchAll(DOUBLE_HYPHEN)) {
        const previous = run.value[match.index - 1];
        const next = run.value[match.index + 2];
        const startsWord = previous === undefined || /[\s("'[]/.test(previous);
        if (startsWord && next !== undefined && /[a-zA-Z0-9]/.test(next)) continue;
        if (isInsideTechnicalName(run.value, match.index)) continue;
        report({
          file: page.file,
          offset: offsetInRun(run, match.index),
          message: `Double hyphen in visible text: "${snippet(run.value, match.index, 2)}"`,
        });
      }
    }
  },
};

function checkedHeadings(page, levels) {
  return page.headings.filter(({ element, level, text }) => {
    if (!levels.includes(level) || text === "") return false;
    if (isInsideHidden(element) || hiddenByClass(element)) return false;
    if (page.styles?.isSometimesHidden(element)) return false;
    return !ancestors(element).some((parent) => parent.name === "footer" || parent.name === "nav");
  });
}

const duplicateHeading = {
  id: "copy/duplicate-heading",
  severity: "warning",
  description: "The same heading text appears twice on a page. Text hidden at some breakpoints, headings for screen readers, footers and navigation are not compared.",
  options: { levels: [1, 2, 3] },
  page(page, { options, report }) {
    const seen = new Map();
    for (const { element, text } of checkedHeadings(page, options.levels)) {
      const key = text.toLowerCase();
      if (seen.has(key)) {
        const first = page.lines.locate(seen.get(key)).line;
        report({ file: page.file, offset: element.start, message: `Heading "${text}" repeats the heading on line ${first}` });
      } else {
        seen.set(key, element.start);
      }
    }
  },
};

const SUBHEAD_ELEMENTS = new Set(["p", "div", "span", "small", "strong", "em", "h1", "h2", "h3", "h4", "h5", "h6"]);

const duplicateSubhead = {
  id: "copy/duplicate-subhead",
  severity: "warning",
  description: "A subhead or the first line after a heading says the same thing as the heading.",
  options: { levels: [1, 2, 3] },
  page(page, { options, report }) {
    const indexes = new Map(page.elements.map((element, index) => [element, index]));
    for (const { element, text } of checkedHeadings(page, options.levels)) {
      let index = indexes.get(element) + 1;
      while (index < page.elements.length && page.elements[index].start < element.end) index += 1;
      const next = page.elements[index];
      if (!next || !SUBHEAD_ELEMENTS.has(next.name)) continue;
      const nextLevel = /^h[1-6]$/.test(next.name) ? Number(next.name[1]) : null;
      // Two checked headings with the same text belong to duplicate-heading.
      if (nextLevel !== null && options.levels.includes(nextLevel)) continue;
      if (textContent(next).toLowerCase() === text.toLowerCase()) {
        report({ file: page.file, offset: next.start, message: `Text after the heading repeats it word for word: "${text}"` });
      }
    }
  },
};

const DEFAULT_PATTERNS = [
  { label: "lorem ipsum", pattern: "\\blorem ipsum\\b", flags: "i" },
  { label: "unfinished marker", pattern: "\\b(?:TODO|FIXME|TBD|XXXX+)\\b|^\\s*XXX\\s*$" },
  { label: "bracketed fill-in", pattern: "\\[\\s*(?:fill|insert|placeholder|todo|tbd|your)\\b[^\\[\\]]*\\]", flags: "i" },
  { label: "template company name", pattern: "\\bYour (?:Company|Business) Name\\b|^\\s*your (?:company|business) name\\s*$" },
  { label: "template text", pattern: "\\b(?:your text here|text goes here|content goes here)\\b|^\\s*(?:placeholder|sample|dummy) text\\s*\\.?\\s*$", flags: "i" },
  { label: "fill-in instruction", pattern: "^\\s*\\[?(?:insert|replace)\\b[^.,\\n]{1,40}\\bhere\\s*[.!\\]]?\\s*$", flags: "i" },
  { label: "placeholder phone number", pattern: "\\(?\\b(?:555\\)?[-. ]555|000\\)?[-. ]000|123\\)?[-. ]456)[-. ]\\d{4}\\b|\\bxxx[-. ]xxx[-. ]xxxx\\b", flags: "i" },
  { label: "placeholder email address", pattern: "\\b(?:you|your|name|user|email|someone)(?:email|name)?@(?:example|domain|yourdomain|email)\\.(?:com|org|net)\\b", flags: "i" },
  { label: "unrendered template", pattern: "\\{\\{[^{}]*\\}\\}|\\{%[^{}]*%\\}|\\$\\{[^{}]*\\}|<%[^%]*%>" },
  { label: "stringified object", pattern: "\\[object Object\\]" },
  { label: "unrendered value", pattern: "^\\s*(?:undefined|null|NaN)\\s*$" },
];

const META_COPY = ["description", "og:title", "og:description", "twitter:title", "twitter:description"];

function compilePatterns(options) {
  return [...options.patterns, ...options.extraPatterns].map((entry) => {
    const spec = typeof entry === "string" ? { pattern: entry, label: entry } : entry;
    return { label: spec.label ?? spec.pattern, regex: new RegExp(spec.pattern, spec.flags ?? "") };
  });
}

const placeholderText = {
  id: "copy/placeholder-text",
  severity: "error",
  description: "Leftover placeholder text in visible copy, image alt text or meta descriptions.",
  options: { patterns: DEFAULT_PATTERNS, extraPatterns: [] },
  validate: compilePatterns,
  page(page, { options, report }) {
    const patterns = compilePatterns(options);
    for (const run of page.textRuns) {
      for (const { label, regex } of patterns) {
        const match = regex.exec(run.value);
        if (match) {
          report({
            file: page.file,
            offset: offsetInRun(run, match.index),
            message: `Placeholder text (${label}): "${snippet(run.value, match.index, match[0].length)}"`,
          });
        }
      }
    }
    const checkAttribute = (element, name, where) => {
      const attr = element.attrs.get(name);
      if (!attr || attr.value.trim() === "") return;
      for (const { label, regex } of patterns) {
        const match = regex.exec(attr.value);
        if (match) {
          report({
            file: page.file,
            offset: attr.valueStart,
            message: `Placeholder text (${label}) in ${where}: "${snippet(attr.value, match.index, match[0].length)}"`,
          });
        }
      }
    };
    for (const element of page.all("img")) checkAttribute(element, "alt", "image alt text");
    for (const element of page.elements) {
      if (element.attrs.has("aria-label")) checkAttribute(element, "aria-label", "an aria-label");
    }
    for (const key of META_COPY) {
      for (const meta of page.metaElements(key)) checkAttribute(meta, "content", `the ${key} meta tag`);
    }
  },
};

export const copyRules = [emDash, doubleHyphen, duplicateHeading, duplicateSubhead, placeholderText];
