import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, rawIndexForDecoded } from "../src/html/entities.js";
import { tokenize } from "../src/html/tokenizer.js";
import { buildTree, getAttr, textContent } from "../src/html/tree.js";
import { Page } from "../src/html/page.js";
import { LineIndex } from "../src/site/lines.js";

function types(source) {
  return tokenize(source).map((token) => token.type);
}

function attrsOf(source) {
  const [tag] = tokenize(source);
  return Object.fromEntries(tag.attrs.map((attr) => [attr.name, attr.value]));
}

test("decodes named, decimal and hex references to the same character", () => {
  assert.equal(decodeEntities("&mdash;&#8212;&#x2014;&#X2014;"), "\u2014".repeat(4));
});

test("numeric references in the Windows-1252 range map the way browsers do", () => {
  assert.equal(decodeEntities("&#151;"), "\u2014");
  assert.equal(decodeEntities("&#150;"), "\u2013");
});

test("an unknown reference and a bare ampersand stay as typed", () => {
  assert.equal(decodeEntities("AT&T &nosuchname; a & b"), "AT&T &nosuchname; a & b");
});

test("a few references decode with no semicolon, but not inside a query string", () => {
  assert.equal(decodeEntities("fish &amp chips"), "fish & chips");
  assert.equal(decodeEntities("/x?a=1&copy=2", { attribute: true }), "/x?a=1&copy=2");
  assert.equal(decodeEntities("/x?a=1&amp;copy=2", { attribute: true }), "/x?a=1&copy=2");
});

test("out-of-range numeric references do not throw", () => {
  assert.equal(decodeEntities("&#xFFFFFFF;"), "\ufffd");
  assert.equal(decodeEntities("&#0;"), "\ufffd");
});

test("maps a decoded index back to the raw source", () => {
  const raw = "ab &amp; cd &mdash; ef";
  const decoded = decodeEntities(raw);
  assert.equal(raw.slice(rawIndexForDecoded(raw, decoded.indexOf("\u2014")), 19), "&mdash;");
  assert.equal(raw[rawIndexForDecoded(raw, decoded.indexOf("c"))], "c");
  assert.equal(raw[rawIndexForDecoded(raw, decoded.length - 1)], "f");
});

test("tokenizes the basic token types", () => {
  assert.deepEqual(types("<!doctype html><!-- c --><p>x</p>"), ["declaration", "comment", "startTag", "text", "endTag"]);
});

test("reads quoted, unquoted, empty and repeated attributes", () => {
  assert.deepEqual(attrsOf(`<a href="x y" title='q' data-a=1 hidden CLASS=Big>`), {
    href: "x y", title: "q", "data-a": "1", hidden: "", class: "Big",
  });
});

test("decodes references in attribute values and records where the value starts", () => {
  const source = '<a href="/x?a=1&amp;b=2">';
  const [tag] = tokenize(source);
  assert.equal(tag.attrs[0].value, "/x?a=1&b=2");
  assert.equal(source.slice(tag.attrs[0].valueStart, tag.attrs[0].valueStart + 2), "/x");
});

test("a less-than sign that opens nothing stays in the text", () => {
  const tokens = tokenize("<p>1 < 2 and 3 <4</p>");
  assert.equal(tokens[1].value, "1 < 2 and 3 <4");
});

test("the content of script and style is not parsed as markup", () => {
  const tokens = tokenize('<script>if (a < b) { x = "<p>"; }</script><p>y</p>');
  assert.deepEqual(tokens.map((token) => token.type), ["startTag", "text", "endTag", "startTag", "text", "endTag"]);
  assert.equal(tokens[1].rawText, true);
});

test("a raw text end tag matches whatever its case", () => {
  assert.deepEqual(types("<STYLE>a{}</StYlE ><p>"), ["startTag", "text", "endTag", "startTag"]);
});

test("title and textarea decode references but hold no markup", () => {
  const tokens = tokenize("<title>a &mdash; <b>c</title>");
  assert.equal(tokens[1].value, "a \u2014 <b>c");
  assert.equal(tokens.length, 3);
});

test("an unterminated comment, script or tag ends at the end of the file without throwing", () => {
  assert.deepEqual(types("<!-- open"), ["comment"]);
  assert.deepEqual(types("<script>var a"), ["startTag", "text"]);
  assert.deepEqual(types('<a href="x'), ["startTag"]);
  assert.deepEqual(types("<a href"), ["startTag"]);
  assert.deepEqual(types("<"), ["text"]);
  assert.deepEqual(types("</"), ["text"]);
});

test("an attribute quote with no closing quote anywhere stops at the end of the tag, keeping the page", () => {
  const tokens = tokenize('<a href="/x>Link</a><p>z</p>');
  assert.equal(tokens[0].attrs[0].value, "/x");
  assert.ok(tokens.some((token) => token.type === "startTag" && token.name === "p"));
});

test("a tag that runs into the next tag ends there", () => {
  const tokens = tokenize("<a href=x <p>y");
  assert.deepEqual(tokens.map((token) => token.name ?? token.type), ["a", "p", "text"]);
});

test("empty comment forms close immediately", () => {
  assert.deepEqual(types("<!--><p>"), ["comment", "startTag"]);
  assert.deepEqual(types("<!---><p>"), ["comment", "startTag"]);
});

test("the tree closes elements that HTML closes implicitly", () => {
  const { elements } = buildTree("<ul><li>one<li>two</ul><p>a<div>b</div><p>c<p>d<table><tr><td>e<td>f<tr><td>g</table>");
  const parentOf = (text) => elements.find((element) => element.children.some((child) => child.type === "text" && child.value === text));
  assert.equal(parentOf("two").parent.name, "ul");
  assert.equal(parentOf("b").parent.name, "#document");
  assert.equal(parentOf("d").parent.name, "#document");
  assert.equal(parentOf("f").parent.name, "tr");
  assert.equal(parentOf("g").parent.name, "tr");
});

test("void elements take no children and a stray end tag is ignored", () => {
  const { elements } = buildTree("<div><br><img src=x>text</span></div>");
  assert.equal(elements[0].children.length, 3);
});

test("a slash closes an element only inside SVG", () => {
  const { elements } = buildTree('<div/><svg><path d="M0"/><circle/></svg>after');
  const div = elements.find((element) => element.name === "div");
  const svg = elements.find((element) => element.name === "svg");
  assert.equal(svg.parent, div);
  assert.equal(svg.children.length, 2);
  assert.equal(div.children.at(-1).value, "after");
});

test("an unclosed heading or link ends at the next one", () => {
  const { elements } = buildTree("<h2>One<h3>Two</h3><a href=a>A<a href=b>B</a>");
  assert.equal(textContent(elements[0]), "One");
  const links = elements.filter((element) => element.name === "a");
  assert.equal(textContent(links[0]), "A");
  assert.equal(getAttr(links[1], "href"), "b");
});

test("thousands of unclosed tags do not overflow the stack", () => {
  const page = new Page("deep.html", `${"<span>".repeat(100000)}text`);
  assert.equal(page.textRuns.length, 1);
  assert.equal(textContent(page.elements[0]), "text");
});

test("text content skips scripts, styles and SVG", () => {
  const { elements } = buildTree("<h1>Hello <script>no()</script><svg><title>no</title></svg>  world</h1>");
  assert.equal(textContent(elements[0]), "Hello world");
});

test("visible text leaves out code, hidden elements and head content but keeps the title", () => {
  const page = new Page(
    "a.html",
    `<title>Shown title</title><style>a{}</style><p>one</p><code>no</code><pre>no</pre><p hidden>no</p>
     <p style="display: none">no</p><template><p>no</p></template><noscript>no</noscript><textarea>no</textarea><svg><text>no</text></svg><p>two</p>`,
  );
  assert.deepEqual(page.textRuns.map((run) => run.value), ["Shown title", "one", "two"]);
});

test("line index handles offsets at line boundaries and CRLF files", () => {
  const lines = new LineIndex("ab\r\ncd\n\ne");
  assert.deepEqual(lines.locate(0), { line: 1, column: 1 });
  assert.deepEqual(lines.locate(4), { line: 2, column: 1 });
  assert.deepEqual(lines.locate(7), { line: 3, column: 1 });
  assert.deepEqual(lines.locate(8), { line: 4, column: 1 });
});

test("a page knows ids, including named anchors", () => {
  const page = new Page("a.html", '<div id="one"></div><a name="two"></a><p name="not-this"></p>');
  assert.deepEqual([...page.ids].sort(), ["one", "two"]);
});
