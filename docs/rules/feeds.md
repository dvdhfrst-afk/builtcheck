# Feeds

Feed rules check the RSS 2.0 and Atom feeds in a build: those that pages announce with `<link rel="alternate" type="application/rss+xml">` or `type="application/atom+xml"`, and any file at a common feed path whose root element is `rss` or `feed`. The common paths are `rss.xml`, `feed.xml`, `atom.xml`, `index.xml`, `feed.rss`, `feed.atom`, `feed/index.xml`, `rss/index.xml`, and `rss.xml`, `feed.xml`, `atom.xml` and `index.xml` under `blog/`. Each feed is checked once, however many pages link it, and findings point at lines in the feed. RSS 1.0 feeds, which are RDF (Resource Description Framework) documents, are not checked.

| Rule | Default | Reports |
|---|---|---|
| `feeds/missing` | error | A page announces a feed that is not in the build. Reported once per feed, at the first page that links it. |
| `feeds/invalid` | error | A feed is not well-formed XML (Extensible Markup Language), an Atom feed is outside the Atom namespace, or a file pages announce as a feed is neither RSS nor Atom. |
| `feeds/required-field` | error | An RSS channel lacks `title`, `link` or `description`, an RSS item has neither `title` nor `description`, an Atom feed or entry lacks `id`, `title` or `updated`, an Atom feed has no `author` while some entry has none either, or an Atom entry has neither `content` nor an alternate link. |
| `feeds/item-link` | error | A feed's own link or an item link points at a page of this site that is not in the build, or an RSS link is relative. |
| `feeds/date` | error | A date is not in its format's syntax: RFC 822 for RSS `pubDate` and `lastBuildDate`, RFC 3339 for Atom `updated` and `published`. A day of the week that does not match the date counts. |
| `feeds/self-link` | warning | The feed's `rel="self"` link points somewhere other than where the feed is: another file, another host or outside the base path. |

Feed rules have no options.

XML has only five named entities, so `&nbsp;` and the like make a feed invalid unless it declares them in a DOCTYPE; the message gives the numeric reference to write instead. Problems that many items share, such as a date format, are reported once, at the first item, with how many there are. RFC 822 dates may use four-digit years and the zone names `GMT`, `UT` and `UTC`, as readers accept. Atom requires an upper case `T` and `Z` in its dates.
