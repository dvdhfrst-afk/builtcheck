// Language rules: lang attributes that are not language tags, and hreflang annotations that
// search engines would ignore or misread. Annotations are read from the pages and from the
// sitemap's xhtml:link entries, and both are held to the same checks.

import { getAttr } from "../html/tree.js";
import { isIndexable, isRedirectPage } from "../site/classify.js";
import { checkHreflang, checkLanguageTag, sameLanguage } from "../seo/language-tags.js";
import { documentLang, hreflangLinks, nameFiles, ruleIsOn } from "../seo/head.js";
import {
  buildSet, entryLanguage, isSettled, isXDefault, namesItself, onceEach, pageSets, sitemapSets, targetProblem,
} from "../seo/hreflang.js";

// The hreflang set of the page being checked, with offsets so findings can point at a line.
function ownSet(page, site) {
  return page.once("i18n:set", () => {
    const links = hreflangLinks(page);
    return links.length === 0 ? null : buildSet(site, { subject: page.file, file: page.file, baseUrl: page.baseUrl, links });
  });
}

// A page whose annotations search engines act on: indexable, with an hreflang set.
function checkedSet(page, site) {
  return isIndexable(page) ? ownSet(page, site) : null;
}

function canonicalUrl(page) {
  const href = page.canonicalHref?.trim();
  if (!href || !/^https?:\/\//i.test(href)) return null;
  try {
    return new URL(href).href;
  } catch {
    return null;
  }
}

// How a finding names an entry: hreflang "fr" (fr/index.html)
function describe(entry) {
  return `hreflang "${entry.value}" (${entry.href})`;
}

// The sitemap sets keyed by the page or URL each describes.
function sitemapBySubject(site) {
  const bySubject = new Map();
  for (const set of sitemapSets(site)) {
    if (set.subjectKey && !bySubject.has(set.subjectKey)) bySubject.set(set.subjectKey, set);
  }
  return bySubject;
}

const langInvalid = {
  id: "i18n/lang-invalid",
  severity: "error",
  description: "A lang attribute holds a value that is not a valid language tag.",
  options: { languages: [] },
  page(page, { options, report }) {
    for (const element of page.elements) {
      const value = getAttr(element, "lang");
      // An empty lang says the language is unknown, which is allowed.
      if (value === null || value.trim() === "" || page.isInTemplate(element)) continue;
      const result = checkLanguageTag(value, options.languages);
      if (result.ok) continue;
      const where = element.name === "html" ? "Page language" : `lang on <${element.name}>`;
      report({ file: page.file, offset: element.start, message: `${where} "${value.trim()}" is not a valid language tag: ${result.reason}` });
    }
  },
};

const hreflangInvalid = {
  id: "i18n/hreflang-invalid",
  severity: "error",
  description: "An hreflang value in a page or the sitemap is not a valid language tag or x-default.",
  options: { languages: [] },
  page(page, { options, report }) {
    if (isRedirectPage(page)) return;
    for (const link of hreflangLinks(page)) {
      const result = checkHreflang(link.hreflang, options.languages);
      if (!result.ok) report({ file: page.file, offset: link.offset, message: `hreflang "${link.hreflang.trim()}" is not a valid language tag: ${result.reason}` });
    }
  },
  site({ site, options, report }) {
    const findings = onceEach(report);
    for (const set of sitemapSets(site)) {
      for (const entry of set.entries) {
        const result = checkHreflang(entry.value, options.languages);
        if (!result.ok) findings.add(entry.value, set.file, entry.offset, `Sitemap hreflang "${entry.value}" is not a valid language tag: ${result.reason}`);
      }
    }
    findings.flush();
  },
};

// The second and later entries giving a value already used in the set.
function repeats(set) {
  const first = new Map();
  const found = [];
  for (const entry of set.entries) {
    const value = entry.value.toLowerCase();
    if (first.has(value)) found.push({ entry, earlier: first.get(value) });
    else first.set(value, entry);
  }
  return found;
}

function repeatMessage(entry, earlier) {
  if (entry.key !== null && entry.key === earlier.key) return `hreflang "${entry.value}" is listed twice for ${entry.href}`;
  return `hreflang "${entry.value}" names two URLs, ${earlier.href} and ${entry.href}, so search engines may ignore both`;
}

const hreflangDuplicate = {
  id: "i18n/hreflang-duplicate",
  severity: "error",
  description: "The same hreflang value appears more than once in one set of alternates.",
  page(page, { site, report }) {
    if (isRedirectPage(page)) return;
    const set = ownSet(page, site);
    if (!set) return;
    for (const { entry, earlier } of repeats(set)) report({ file: page.file, offset: entry.offset, message: repeatMessage(entry, earlier) });
  },
  site({ site, report }) {
    const findings = onceEach(report);
    for (const set of sitemapSets(site)) {
      for (const { entry, earlier } of repeats(set)) {
        findings.add(`${entry.value.toLowerCase()} ${earlier.href} ${entry.href}`, set.file, entry.offset, `Sitemap entry for ${set.subjectUrl}: ${repeatMessage(entry, earlier)}`);
      }
    }
    findings.flush();
  },
};

const hreflangSelf = {
  id: "i18n/hreflang-self",
  severity: "warning",
  description: "A set of hreflang alternates does not include the page it is on.",
  page(page, { site, report }) {
    const set = checkedSet(page, site);
    if (!set) return;
    const canonical = canonicalUrl(page);
    if (namesItself(set, canonical) || (!isSettled(set, site) && canonical === null)) return;
    report({
      file: page.file,
      offset: set.entries[0].offset,
      message: "Page lists other language versions but not itself. Each version must list every version, itself included",
    });
  },
  site({ site, report }) {
    for (const set of sitemapSets(site)) {
      if (namesItself(set)) continue;
      report({ file: set.file, offset: set.offset, message: `Sitemap entry for ${set.subjectUrl} lists other language versions but not itself` });
    }
  },
};

const hreflangTarget = {
  id: "i18n/hreflang-target",
  severity: "error",
  description: "An hreflang alternate names a page that is not in the build, redirects, asks not to be indexed or names another canonical.",
  page(page, { site, report }) {
    const set = checkedSet(page, site);
    if (!set) return;
    // The link rules already report an alternate link with nothing behind it.
    const linksReportMissing = ruleIsOn(site, "links/broken-internal");
    for (const entry of set.entries) {
      if (entry.target.kind === "missing" && linksReportMissing) continue;
      const problem = targetProblem(entry.target);
      if (problem) report({ file: page.file, offset: entry.offset, message: `Alternate ${describe(entry)} ${problem}, so search engines ignore the set` });
    }
  },
  site({ site, report }) {
    const findings = onceEach(report);
    for (const set of sitemapSets(site)) {
      for (const entry of set.entries) {
        const problem = /^https?:\/\//i.test(entry.href) ? targetProblem(entry.target) : "is not an absolute URL, which sitemaps require";
        if (problem) findings.add(`${entry.href} ${problem}`, set.file, entry.offset, `Sitemap alternate ${describe(entry)} ${problem}`);
      }
    }
    findings.flush();
  },
};

// The entries of a set that name another version which must link back: language versions,
// once per target. An x-default often names a chooser page, which need not link back.
function versionsToConfirm(set) {
  const seen = new Set();
  return set.entries.filter((entry) => {
    if (isXDefault(entry) || entry.key === null || entry.key === set.subjectKey || seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

const hreflangReciprocal = {
  id: "i18n/hreflang-reciprocal",
  severity: "error",
  description: "A language version named in hreflang does not link back, so search engines ignore the pair.",
  page(page, { site, report }) {
    const set = checkedSet(page, site);
    if (!set || !isSettled(set, site)) return;
    const canonical = canonicalUrl(page);
    const sets = pageSets(site);
    for (const entry of versionsToConfirm(set)) {
      if (entry.target.kind !== "page" || targetProblem(entry.target)) continue;
      const other = sets.get(entry.target.file);
      if (other && !isSettled(other, site)) continue;
      const linksBack = other?.entries.some((back) => back.key === set.subjectKey || (canonical !== null && back.key === `url:${canonical}`));
      if (linksBack) continue;
      report({
        file: page.file,
        offset: entry.offset,
        message: other
          ? `Alternate ${describe(entry)} lists language versions, but not this page. Both pages must name each other`
          : `Alternate ${describe(entry)} has no hreflang links, so it does not link back. Both pages must name each other`,
      });
    }
  },
  site({ site, report }) {
    const bySubject = sitemapBySubject(site);
    const findings = onceEach(report);
    for (const set of sitemapSets(site)) {
      for (const entry of versionsToConfirm(set)) {
        const other = bySubject.get(entry.key);
        if (!other) {
          if (entry.target.kind === "page" && !targetProblem(entry.target)) {
            findings.add(`none ${entry.key}`, set.file, entry.offset, `Sitemap lists ${entry.href} as an alternate, but has no entry of its own for it listing the alternates back`);
          }
        } else if (!other.entries.some((back) => back.key === set.subjectKey)) {
          findings.add(`${entry.key} ${set.subjectKey}`, set.file, entry.offset, `Sitemap entry for ${entry.href} does not list ${set.subjectUrl} back as an alternate`);
        }
      }
    }
    findings.flush();
  },
};

// A problem with the x-default of a set, or null. `others` finds the set of another version.
function xDefaultProblem(set, others) {
  const defaults = set.entries.filter(isXDefault);
  if (defaults.length === 0) return null;
  if (defaults.length === set.entries.length) return { entry: defaults[0], message: "Only an x-default alternate is given, which means nothing without the language versions" };
  for (const entry of versionsToConfirm(set)) {
    const other = others(entry.key);
    const theirs = other?.entries.find(isXDefault);
    if (theirs && theirs.key !== defaults[0].key) {
      return { entry: defaults[0], message: `x-default is ${defaults[0].href} here, but ${entry.href} names ${theirs.href}. Every version should name the same x-default` };
    }
  }
  return null;
}

const xDefault = {
  id: "i18n/x-default",
  severity: "warning",
  description: "An x-default alternate stands alone, or the versions of a page disagree on it.",
  page(page, { site, report }) {
    const set = checkedSet(page, site);
    if (!set) return;
    const sets = pageSets(site);
    const problem = xDefaultProblem(set, (key) => (key.startsWith("file:") ? sets.get(key.slice(5)) : undefined));
    if (problem) report({ file: page.file, offset: problem.entry.offset, message: problem.message });
  },
  site({ site, report }) {
    const bySubject = sitemapBySubject(site);
    for (const set of sitemapSets(site)) {
      const problem = xDefaultProblem(set, (key) => bySubject.get(key));
      if (problem) report({ file: set.file, offset: problem.entry.offset, message: `Sitemap entry for ${set.subjectUrl}: ${problem.message}` });
    }
  },
};

const reverseIndexes = new WeakMap();

// For each page, the hreflang values other indexable pages give it. Result: Map of file to
// [{ source, entry }].
function namedAs(site) {
  if (reverseIndexes.has(site)) return reverseIndexes.get(site);
  const index = new Map();
  for (const [source, set] of pageSets(site)) {
    for (const entry of set.entries) {
      if (entry.target.kind !== "page" || entryLanguage(entry) === null) continue;
      if (!index.has(entry.target.file)) index.set(entry.target.file, []);
      index.get(entry.target.file).push({ source, entry });
    }
  }
  reverseIndexes.set(site, index);
  return index;
}

// The language subtag of a page's valid lang, or null.
function pageLanguage(lang) {
  if (!lang) return null;
  const result = checkLanguageTag(lang);
  return result.ok && !result.privateUse ? result.language : null;
}

const langMismatch = {
  id: "i18n/lang-mismatch",
  severity: "warning",
  description: "A page's lang names a different language from the hreflang other versions give it.",
  page(page, { site, report }) {
    if (!isIndexable(page)) return;
    const lang = documentLang(page)?.trim();
    const language = pageLanguage(lang);
    if (!language) return;
    const byValue = new Map();
    for (const { source, entry } of namedAs(site).get(page.file) ?? []) {
      if (sameLanguage(language, entryLanguage(entry))) continue;
      const value = entry.value.toLowerCase();
      if (!byValue.has(value)) byValue.set(value, { value: entry.value, sources: [], itself: false });
      const group = byValue.get(value);
      if (source === page.file) group.itself = true;
      else if (!group.sources.includes(source)) group.sources.push(source);
    }
    for (const { value, itself, sources: others } of byValue.values()) {
      const sources = itself ? [...others, "this page"] : others;
      report({
        file: page.file,
        offset: page.first("html")?.start ?? null,
        message: `Page has lang "${lang}", but ${nameFiles(sources)} ${sources.length === 1 ? "lists" : "list"} it as hreflang "${value}". One of them is wrong`,
      });
    }
  },
  site({ site, report }) {
    const findings = onceEach(report);
    for (const set of sitemapSets(site)) {
      for (const entry of set.entries) {
        const summary = entry.target.kind === "page" ? entry.target.summary : null;
        const language = pageLanguage(summary?.lang?.trim());
        const named = entryLanguage(entry);
        if (!language || named === null || sameLanguage(language, named)) continue;
        findings.add(`${summary.file} ${entry.value.toLowerCase()}`, set.file, entry.offset, `Sitemap gives ${summary.file} hreflang "${entry.value}", but that page has lang "${summary.lang.trim()}"`);
      }
    }
    findings.flush();
  },
};

export const i18nRules = [
  langInvalid, hreflangInvalid, hreflangDuplicate, hreflangSelf, hreflangTarget, hreflangReciprocal, xDefault, langMismatch,
];
