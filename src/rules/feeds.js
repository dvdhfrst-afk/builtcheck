// Feed and web app manifest rules. Feeds are the RSS 2.0 and Atom files that pages announce with
// <link rel="alternate">, and those at the paths generators use. Each is checked once, however
// many pages link it, and findings point into the feed itself.

import { ATOM, COMMON_FEED_PATHS, atomLinks, childText, isFeedLink, readFeed } from "../assets/feeds.js";
import { firstTime, linkedDocuments, servedPath } from "../assets/linked.js";
import { rfc3339Problem, rfc822Problem } from "../assets/dates.js";
import { childElements, firstChild, xmlBase } from "../assets/xml.js";
import { resolveReference } from "../site/urls.js";

// A rule over every feed in the build. `check(feed, context, linked)` runs once per feed, where
// `linked` says a page announced it, so it must be a feed. A file at a common path that does not
// look like a feed is not one.
function feedRule({ id, severity, description, check }) {
  return {
    id,
    severity,
    description,
    site(context) {
      const { site } = context;
      for (const file of COMMON_FEED_PATHS) {
        if (!site.hasFile(file) || site.ignored(file)) continue;
        const feed = readFeed(site, file);
        if (feed?.looksLikeFeed && firstTime(context, file)) check(feed, context, false);
      }
    },
    page(page, context) {
      for (const { file } of linkedDocuments(page, context.site, isFeedLink)) {
        if (!file || context.site.ignored(file) || !firstTime(context, file)) continue;
        const feed = readFeed(context.site, file);
        if (feed) check(feed, context, true);
      }
    },
  };
}

const feedMissing = {
  id: "feeds/missing",
  severity: "error",
  description: "A page announces a feed that is not in the build.",
  page(page, context) {
    const { site, report } = context;
    for (const { element, href, missing, path } of linkedDocuments(page, site, isFeedLink)) {
      if (!missing || !firstTime(context, path)) continue;
      report({ file: page.file, offset: element.start, message: `Page announces the feed ${href}, which is not in the build. Feed readers that follow it get nothing` });
    }
  },
};

const feedInvalid = feedRule({
  id: "feeds/invalid",
  severity: "error",
  description: "A feed is not well-formed XML, or a linked feed is not RSS or Atom.",
  check(feed, { report }, linked) {
    if (feed.error) {
      report({ file: feed.file, offset: feed.error.offset, message: `Feed is not well-formed XML, so feed readers reject it: it ${feed.error.message}` });
    } else if (!feed.kind && feed.root.local === "feed") {
      report({ file: feed.file, offset: feed.root.start, message: `Atom <feed> is not in the Atom namespace, so readers do not take it for Atom. Add xmlns="${ATOM}"` });
    } else if (!feed.kind && linked && feed.root.local !== "RDF") {
      // RSS 1.0 is a feed too, in RDF; it is only not one these rules read.
      report({ file: feed.file, offset: feed.root.start, message: `Pages announce this file as a feed, but its root element is <${feed.root.name}>, not an RSS <rss> or Atom <feed>` });
    }
  },
});

// Reports one finding for a problem many items share, at the first of them.
function reportGrouped(report, file, items, total, describe, singular = "item") {
  if (items.length === 0) return;
  const noun = total === 1 ? singular : singular === "entry" ? "entries" : `${singular}s`;
  const count = items.length === total ? (total === 1 ? `The only ${singular}` : `All ${total} ${noun}`) : `${items.length} of ${total} ${noun}`;
  report({ file, offset: items[0].start, message: `${count} ${describe(items.length)}` });
}

function hasText(element, local, ns) {
  const text = childText(element, local, ns);
  return text !== null && text !== "";
}

function checkRssFields(feed, report) {
  const channel = feed.container;
  if (!channel) {
    report({ file: feed.file, offset: feed.root.start, message: "RSS feed has no <channel> element, so it holds nothing a reader can show" });
    return;
  }
  const missing = ["title", "link"].filter((name) => !hasText(channel, name, null));
  if (!firstChild(channel, "description", null)) missing.push("description");
  if (missing.length > 0) {
    report({ file: feed.file, offset: channel.start, message: `RSS <channel> has no ${missing.map((name) => `<${name}>`).join(", ")}, which RSS 2.0 requires` });
  }
  const bare = feed.items.filter((item) => !hasText(item, "title", null) && !hasText(item, "description", null));
  reportGrouped(report, feed.file, bare, feed.items.length, (n) => `${n === 1 ? "has" : "have"} neither a <title> nor a <description>, so readers show ${n === 1 ? "it" : "them"} blank`);
}

function hasAuthor(element) {
  return childElements(element, "author", ATOM).length > 0 || Boolean(firstChild(element, "source", ATOM) && childElements(firstChild(element, "source", ATOM), "author", ATOM).length > 0);
}

function checkAtomFields(feed, report) {
  const missing = ["id", "title", "updated"].filter((name) => !hasText(feed.root, name, ATOM));
  if (missing.length > 0) {
    report({ file: feed.file, offset: feed.root.start, message: `Atom <feed> has no ${missing.map((name) => `<${name}>`).join(", ")}, which Atom requires` });
  }
  const authorless = feed.items.filter((entry) => !hasAuthor(entry));
  if (!hasAuthor(feed.root) && authorless.length > 0) {
    report({ file: feed.file, offset: feed.root.start, message: `Atom <feed> has no <author>, and ${authorless.length === 1 ? "an entry has" : `${authorless.length} entries have`} none of their own. Atom requires one or the other` });
  }
  for (const name of ["id", "title", "updated"]) {
    const without = feed.items.filter((entry) => !hasText(entry, name, ATOM));
    reportGrouped(report, feed.file, without, feed.items.length, (n) => `${n === 1 ? "has" : "have"} no <${name}>, which every Atom entry needs`, "entry");
  }
  const unlinked = feed.items.filter((entry) => !firstChild(entry, "content", ATOM) && atomLinks(entry, "alternate").length === 0);
  reportGrouped(report, feed.file, unlinked, feed.items.length, (n) => `${n === 1 ? "has" : "have"} neither <content> nor an alternate <link>, so there is nothing to read`, "entry");
}

const feedRequiredField = feedRule({
  id: "feeds/required-field",
  severity: "error",
  description: "A feed or one of its items lacks a field its format requires.",
  check(feed, { report }) {
    if (feed.kind === "rss") checkRssFields(feed, report);
    else if (feed.kind === "atom") checkAtomFields(feed, report);
  },
});

// The links a feed gives for itself and its items: [{ element, href, base, rss }].
function feedPageLinks(feed) {
  const links = [];
  if (feed.kind === "rss" && feed.container) {
    for (const holder of [feed.container, ...feed.items]) {
      const link = firstChild(holder, "link", null);
      if (link && link.text.trim() !== "") links.push({ element: link, href: link.text.trim(), base: feed.url, rss: true });
    }
  } else if (feed.kind === "atom") {
    for (const holder of [feed.root, ...feed.items]) {
      for (const link of atomLinks(holder, "alternate")) {
        const href = link.attrs.get("href")?.trim();
        if (href) links.push({ element: link, href, base: xmlBase(link, feed.url), rss: false });
      }
    }
  }
  return links;
}

const feedItemLink = feedRule({
  id: "feeds/item-link",
  severity: "error",
  description: "A feed links to a page of this site that is not in the build, or an RSS link is not an absolute URL.",
  check(feed, { site, report }) {
    for (const { element, href, base, rss } of feedPageLinks(feed)) {
      if (rss && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        report({ file: feed.file, offset: element.start, message: `RSS <link> ${href} is relative. RSS needs absolute URLs, and readers cannot open this one` });
        continue;
      }
      const resolved = resolveReference(href, base, site);
      if (resolved.kind === "invalid") {
        report({ file: feed.file, offset: element.start, message: `Feed link ${href} is not a valid URL` });
      } else if (resolved.kind === "internal" && site.lookup(resolved.path) === null) {
        report({ file: feed.file, offset: element.start, message: `Feed link ${href} leads to no page in the build` });
      }
    }
  },
});

// The date elements of a feed and the format each must follow: [{ element, problem }].
function feedDates(feed) {
  const found = [];
  const add = (holder, names, ns, check) => {
    for (const name of names) {
      for (const element of childElements(holder, name, ns)) found.push({ element, problem: check(element.text) });
    }
  };
  if (feed.kind === "rss" && feed.container) {
    add(feed.container, ["pubDate", "lastBuildDate"], null, rfc822Problem);
    for (const item of feed.items) add(item, ["pubDate"], null, rfc822Problem);
  } else if (feed.kind === "atom") {
    add(feed.root, ["updated"], ATOM, rfc3339Problem);
    for (const entry of feed.items) add(entry, ["updated", "published"], ATOM, rfc3339Problem);
  }
  return found;
}

const feedDate = feedRule({
  id: "feeds/date",
  severity: "error",
  description: "A feed date is not in its format's date syntax: RFC 822 for RSS, RFC 3339 for Atom.",
  check(feed, { report }) {
    const byName = new Map();
    for (const { element, problem } of feedDates(feed)) {
      if (!problem) continue;
      if (!byName.has(element.name)) byName.set(element.name, []);
      byName.get(element.name).push({ element, problem });
    }
    // A template writes every date the same way, so one finding per element name says it all.
    for (const [name, bad] of byName) {
      const [{ element, problem }] = bad;
      const more = bad.length > 1 ? ` (${bad.length} <${name}> dates in this feed are invalid)` : "";
      report({ file: feed.file, offset: element.start, message: `<${name}> "${element.text.trim()}" ${problem}${more}` });
    }
  },
});

// The rel="self" links a feed gives for its own address.
function selfLinks(feed) {
  if (feed.kind === "rss" && feed.container) return atomLinks(feed.container, "self");
  if (feed.kind === "atom") return atomLinks(feed.root, "self");
  return [];
}

const feedSelfLink = feedRule({
  id: "feeds/self-link",
  severity: "warning",
  description: "A feed's self link does not point at where the feed is.",
  check(feed, { site, report }) {
    const own = servedPath(site, feed.file);
    for (const link of selfLinks(feed)) {
      const href = link.attrs.get("href")?.trim() ?? "";
      const resolved = resolveReference(href, xmlBase(link, feed.url), site);
      let problem = null;
      if (href === "" || resolved.kind === "invalid") problem = "is not a valid URL";
      else if (resolved.kind === "external" && site.ownHost !== null) problem = "points at another host";
      else if (resolved.kind === "outside") problem = "is outside the base path";
      else if (resolved.kind === "internal" && site.lookup(resolved.path)?.file !== feed.file) problem = `points at ${resolved.path}`;
      if (problem) {
        report({ file: feed.file, offset: link.start, message: `Feed's self link ${href} ${problem}, but the feed is at ${own}. Readers use it to know where to fetch updates` });
      }
    }
  },
});

export const feedRules = [feedMissing, feedInvalid, feedRequiredField, feedItemLink, feedDate, feedSelfLink];
