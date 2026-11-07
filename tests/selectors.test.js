import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaQueryState, PageStyles } from "../src/css/cascade.js";
import { compareSpecificity, elementMatches, parseSelectorList, resolveNesting } from "../src/css/selectors.js";
import { audit } from "../src/audit.js";
import { Page } from "../src/html/page.js";
import { getAttr } from "../src/html/tree.js";
import { page as html, withSite } from "./helpers.js";

const DOCUMENT = new Page(
  "a.html",
  `<!doctype html><html><body id="top" class="home dark">
  <main><ul id="list"><li id="one" class="item first">a</li><li id="two" class="item">b</li><li id="three" class="item" data-kind="x y" lang="en-US">c</li></ul>
  <p id="para" class="md:gap-4 w-1/2">t</p><span id="after"></span><a id="link" href="/x" target="_BLANK">l</a><a id="plain">m</a><div id="void"> </div><div id="empty"><!-- c --></div></main></body></html>`,
);
const byId = (id) => DOCUMENT.elements.find((element) => getAttr(element, "id") === id);
const matches = (id, selector) => elementMatches(byId(id), selector);

const MATCHING = [
  ["one", "li"], ["one", "*"], ["one", "#one"], ["one", ".item"], ["one", "li.item.first#one"],
  ["one", "ul li"], ["one", "ul > li"], ["one", "body li"], ["one", "#list .first"], ["two", "#one + li"], ["three", "#one ~ .item"],
  ["three", "[data-kind]"], ["three", '[data-kind="x y"]'], ["three", "[data-kind~=y]"], ["three", "[lang|=en]"], ["three", "[data-kind^=x]"],
  ["three", "[data-kind$=y]"], ["three", "[data-kind*=' ']"], ["link", "a[target=_blank i]"], ["link", "a:link"], ["link", "a:any-link"],
  ["one", "li:first-child"], ["three", "li:last-child"], ["two", "li:nth-child(2)"], ["three", "li:nth-child(odd)"], ["two", "li:nth-child(even)"],
  ["three", "li:nth-child(2n+1)"], ["one", "li:nth-child(-n+1)"], ["two", "li:nth-last-child(2)"], ["two", "li:nth-of-type(2)"], ["one", "li:first-of-type"],
  ["three", "li:last-of-type"], ["void", "div:first-of-type"], ["empty", "div:empty"], ["empty", "div:last-of-type"],
  ["one", ":is(ul, ol) > li"], ["one", ":where(ul) li"], ["two", "li:not(.first)"], ["two", "li:not(.first, #three)"],
  ["para", ".md\\:gap-4"], ["para", ".w-1\\/2"], ["one", "ul li, nope"], ["one", "nope, ul li"], ["top", "body.home"], ["top", "html > body"],
  // States a static file cannot rule out.
  ["link", "a:hover"], ["link", "a:focus-visible"], ["one", "li:has(a)"], ["one", "li:not(:hover)"], ["one", "li:unknown-state"], ["one", "li::before"], ["one", "li:after"],
];

for (const [id, selector] of MATCHING) {
  test(`#${id} could match ${selector}`, () => assert.equal(matches(id, selector), true));
}

const NOT_MATCHING = [
  ["one", "ol"], ["one", "#two"], ["one", ".nope"], ["one", "li.item.nope"], ["one", "ol li"], ["one", "body > li"], ["one", "#two + li"], ["one", "#two ~ li"],
  ["three", "[data-kind=x]"], ["three", "[nope]"], ["three", "[lang|=e]"], ["three", "[data-kind^='']"], ["link", "a[target=_blank]"], ["plain", "a:link"],
  ["two", "li:first-child"], ["two", "li:last-child"], ["one", "li:nth-child(even)"], ["one", "li:nth-last-child(1)"], ["void", "div:empty"], ["one", "li:not(.item)"],
  ["one", ":is(ol, dl) > li"], ["one", ".ITEM"], ["top", "body > body"],
];

for (const [id, selector] of NOT_MATCHING) {
  test(`#${id} does not match ${selector}`, () => assert.equal(matches(id, selector), false));
}

test("selectors a static file cannot decide are marked conditional", () => {
  const conditional = (text) => parseSelectorList(text)[0].conditional;
  assert.equal(conditional("a:hover"), true);
  assert.equal(conditional("a:not(:hover)"), true);
  assert.equal(conditional("li:nth-child(2n of .a)"), true);
  assert.equal(conditional("a.b > c"), false);
  assert.equal(conditional("a:first-child"), false);
});

test("pseudo-elements are recorded, in either spelling", () => {
  assert.equal(parseSelectorList("a::before")[0].pseudoElement, "before");
  assert.equal(parseSelectorList("a:after")[0].pseudoElement, "after");
  assert.equal(parseSelectorList("input::-webkit-outer-spin-button")[0].pseudoElement, "-webkit-outer-spin-button");
  assert.equal(parseSelectorList("a:hover")[0].pseudoElement, null);
});

test("broken selectors do not throw and could match anything", () => {
  for (const text of ["a >", "> a", ".", "#", "a[", "a[b=", "a:not(", "!!", "a..b", "::", "a[b$]", "a{"]) {
    const [first] = parseSelectorList(text);
    assert.ok(first === undefined || first.unparsed || first.parts.length > 0, text);
    assert.doesNotThrow(() => elementMatches(byId("one"), text), text);
  }
  assert.equal(parseSelectorList("a >")[0].unparsed, true);
  assert.deepEqual(parseSelectorList("  "), []);
});

const SPECIFICITY = [
  ["*", [0, 0, 0]], ["a", [0, 0, 1]], [".a", [0, 1, 0]], ["#a", [1, 0, 0]], ["a.b#c", [1, 1, 1]], ["a b > c", [0, 0, 3]], ["[a]", [0, 1, 0]],
  ["a:hover", [0, 1, 1]], ["a::before", [0, 0, 2]], [":where(#a, .b) c", [0, 0, 1]], [":is(#a, .b) c", [1, 0, 1]], [":not(.a, #b)", [1, 0, 0]], ["a:nth-child(2)", [0, 1, 1]],
];

for (const [selector, expected] of SPECIFICITY) {
  test(`specificity of ${selector}`, () => assert.deepEqual(parseSelectorList(selector)[0].specificity, expected));
}

test("specificity compares ids, then classes, then types", () => {
  assert.ok(compareSpecificity([1, 0, 0], [0, 9, 9]) > 0);
  assert.ok(compareSpecificity([0, 1, 0], [0, 0, 9]) > 0);
  assert.equal(compareSpecificity([0, 1, 1], [0, 1, 1]), 0);
});

test("resolves nested selectors", () => {
  assert.equal(resolveNesting([".a"]), ".a");
  assert.equal(resolveNesting([".a", ".b"]), ":is(.a) .b");
  assert.equal(resolveNesting([".a", "&:hover"]), ":is(.a):hover");
  assert.equal(resolveNesting([".a, .b", "> .c, & .d"]), ":is(.a, .b) > .c, :is(.a, .b) .d");
  assert.equal(elementMatches(byId("one"), resolveNesting(["ul", "> li"])), true);
});

test("every kind of media query is classified", () => {
  for (const query of ["", "all", "screen", "only screen", "not print", "print, screen"]) assert.equal(mediaQueryState(query), "always", query);
  for (const query of ["print", "only print", "speech", "not all", "print, speech"]) assert.equal(mediaQueryState(query), "never", query);
  for (const query of ["(max-width: 600px)", "screen and (min-width: 1px)", "(prefers-color-scheme: dark)", "print, (hover)"]) assert.equal(mediaQueryState(query), "sometimes", query);
});

// ---- The cascade, seen through a real site

function winner(css, body, id, property) {
  const root = new Page("index.html", html(body, `<style>${css}</style>`));
  root.baseUrl = "http://builtcheck.invalid/index.html";
  const styles = new PageStyles(root, { lookup: () => null, isOwnHost: () => false, stripBasePath: (path) => path, stylesheet: () => null, basePath: "" });
  const element = root.elements.find((candidate) => getAttr(candidate, "id") === id);
  return { styles, element, result: styles.cascaded(element, property) };
}

const value = (css, body, id, property) => winner(css, body, id, property).result.winner?.value ?? null;

test("later wins among equals, and higher specificity wins whatever the order", () => {
  assert.equal(value(".a{color:red}.a{color:blue}", '<p id="p" class="a">x</p>', "p", "color"), "blue");
  assert.equal(value("#p{color:red}.a{color:blue}", '<p id="p" class="a">x</p>', "p", "color"), "red");
  assert.equal(value(".a.b{color:red}.a{color:blue}", '<p id="p" class="a b">x</p>', "p", "color"), "red");
});

test("!important beats specificity, and inline styles beat all but !important", () => {
  assert.equal(value("p{color:red!important}#p{color:blue}", '<p id="p">x</p>', "p", "color"), "red");
  assert.equal(value("#p{color:blue}", '<p id="p" style="color:green">x</p>', "p", "color"), "green");
  assert.equal(value("p{color:red!important}", '<p id="p" style="color:green">x</p>', "p", "color"), "red");
  assert.equal(value("", '<p id="p" style="color:green!important">x</p>', "p", "color"), "green");
});

test("unlayered rules beat layered ones, later layers beat earlier, and !important reverses that", () => {
  assert.equal(value("@layer a{#p{color:red}}p{color:blue}", '<p id="p">x</p>', "p", "color"), "blue");
  assert.equal(value("@layer a,b;@layer b{p{color:red}}@layer a{#p{color:blue}}", '<p id="p">x</p>', "p", "color"), "red");
  assert.equal(value("@layer a,b;@layer b{p{color:red!important}}@layer a{p{color:blue!important}}", '<p id="p">x</p>', "p", "color"), "blue");
});

test("width queries and states are kept apart from what always applies", () => {
  const css = ".a{color:red}@media (min-width:600px){.a{color:blue}}.a:hover{color:green}";
  const { result } = winner(css, '<p id="p" class="a">x</p>', "p", "color");
  assert.equal(result.winner.value, "red");
  assert.deepEqual(result.sometimes.map((entry) => entry.value), ["blue", "green"]);
});

test("print rules, keyframes and pseudo-elements do not reach the element", () => {
  assert.equal(value("@media print{.a{color:red}}", '<p id="p" class="a">x</p>', "p", "color"), null);
  assert.equal(value("@keyframes k{from{color:red}}", '<p id="p">x</p>', "p", "color"), null);
  assert.equal(value("#p::before{color:red}", '<p id="p">x</p>', "p", "color"), null);
  assert.equal(value("@media screen{#p{color:red}}", '<p id="p">x</p>', "p", "color"), "red");
  assert.equal(value("@supports (display:grid){#p{color:red}}", '<p id="p">x</p>', "p", "color"), "red");
});

test("nested rules reach the element", () => {
  assert.equal(value("ul{& > #p{color:red}}", '<ul><li id="p">x</li></ul>', "p", "color"), "red");
  assert.equal(value(".a{.b &{color:red}}", '<div class="b"><p id="p" class="a">x</p></div>', "p", "color"), "red");
});

test("hiding follows the cascade, the ancestors and inheritance", () => {
  const always = (css, body = '<div class="a"><p id="p" class="b">x</p></div>') => {
    const { styles, element } = winner(css, body, "p", "display");
    return styles.isAlwaysHidden(element);
  };
  assert.equal(always(".b{display:none}"), true);
  assert.equal(always(".a{display:none}"), true);
  assert.equal(always(".a{display:none}.b{display:block}"), true);
  assert.equal(always(".b{display:none}.a .b{display:block}"), false);
  assert.equal(always(".a{visibility:hidden}"), true);
  assert.equal(always(".a{visibility:hidden}.b{visibility:visible}"), false);
  assert.equal(always(".b{display:none}@media (min-width:600px){.b{display:block}}"), false);
  assert.equal(always(".b{display:none}.b.open{display:block}"), false);
  assert.equal(always(".b{display:none}.open .b{display:block}"), false);
  assert.equal(always(".b{display:none}.b:hover{display:block}"), false);
  assert.equal(always("@media (max-width:600px){.b{display:none}}"), false);
  assert.equal(always("@media print{.b{display:none}}"), false);
  assert.equal(always(".c{display:none}"), false);
});

test("a page hidden until a script runs does not hide all of its copy", () => {
  const body = '<p id="p">x</p>';
  for (const css of ["body{display:none}", "html{visibility:hidden}", "body{visibility:hidden}", "main{display:none}"]) {
    const { styles, element } = winner(css, `<main>${body}</main>`, "p", "display");
    assert.equal(styles.isAlwaysHidden(element), false, css);
  }
});

test("sometimes hidden includes either direction of a breakpoint", () => {
  const sometimes = (css) => {
    const { styles, element } = winner(css, '<p id="p" class="b">x</p>', "p", "display");
    return styles.isSometimesHidden(element);
  };
  assert.equal(sometimes(".b{display:none}@media (min-width:600px){.b{display:block}}"), true);
  assert.equal(sometimes("@media (max-width:600px){.b{display:none}}"), true);
  assert.equal(sometimes(".b{display:none}"), true);
  assert.equal(sometimes(".b{display:block}"), false);
});

test("a page loads linked sheets, follows @import, and skips print and alternate sheets", () => {
  const files = {
    "a.css": '@import "b.css";@import url(c.css) print;.a{color:red}',
    "b.css": ".b{color:red}.a{color:blue}",
    "c.css": ".c{color:red}",
    "d.css": ".d{color:red}",
    "e.css": ".e{color:red}",
    "loop.css": '@import "loop.css";.l{color:red}',
  };
  const head = '<link rel="stylesheet" href="a.css"><link rel="stylesheet" href="d.css" media="print"><link rel="alternate stylesheet" href="e.css"><link rel="stylesheet" href="loop.css"><link rel="stylesheet" href="https://other.example/x.css">';
  withSite({ ...files, "index.html": html('<p id="p" class="a b c d e l">x</p>', head) }, (root) => {
    let seen = null;
    const probe = {
      id: "copy/probe",
      severity: "error",
      description: "Records what the cascade says, for this test.",
      page(page) {
        const element = page.elements.find((candidate) => getAttr(candidate, "id") === "p");
        const values = page.styles.matchedDeclarations(element, "color").map((entry) => `${entry.source.file}:${entry.declaration.selector}:${entry.value}`);
        seen = values;
      },
    };
    audit(root, { rules: {} }, [probe]);
    assert.ok(seen.includes("a.css:.a:red"));
    assert.ok(seen.includes("b.css:.b:red"));
    assert.ok(seen.includes("b.css:.a:blue"));
    assert.ok(seen.includes("loop.css:.l:red"));
    assert.ok(!seen.some((entry) => /^[cde]\.css/.test(entry)));
    // An @import comes before the rules of the sheet that imports it.
    assert.ok(seen.indexOf("b.css:.a:blue") < seen.indexOf("a.css:.a:red"));
  });
});
