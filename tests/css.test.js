import assert from "node:assert/strict";
import { test } from "node:test";
import { findPureColors } from "../src/css/colors.js";
import { familiesFromDeclaration, familiesFromWebFontUrl, normalizeFamily } from "../src/css/fonts.js";
import { blankStringsAndUrls, findUrls, importTarget, scanCss } from "../src/css/scanner.js";

function declarations(css) {
  return scanCss(css).declarations.map(({ property, value }) => [property, value]);
}

test("reads declarations from minified rules, with the last semicolon missing", () => {
  assert.deepEqual(declarations("a{color:red;margin:0}b{top:1px}"), [["color", "red"], ["margin", "0"], ["top", "1px"]]);
});

test("reads a bare declaration list, as in a style attribute", () => {
  assert.deepEqual(declarations("color: red; margin: 0"), [["color", "red"], ["margin", "0"]]);
});

test("records the selector and enclosing at-rules", () => {
  const [inner] = scanCss("@media (max-width: 600px) { .a, .b { color: red } }").declarations;
  assert.equal(inner.selector, ".a, .b");
  assert.deepEqual(inner.atRules, ["@media (max-width: 600px)"]);
});

test("handles nested rules", () => {
  const found = scanCss(".a { color: red; &:hover { color: blue } }").declarations;
  assert.deepEqual(found.map((d) => [d.selector, d.value]), [[".a", "red"], ["&:hover", "blue"]]);
});

test("offsets point at the property and the value in the original text", () => {
  const css = "/* x */ a {\n  color : red;\n}";
  const [declaration] = scanCss(css).declarations;
  assert.equal(css.slice(declaration.offset, declaration.offset + 5), "color");
  assert.equal(css.slice(declaration.valueOffset, declaration.valueOffset + 3), "red");
});

test("comments do not produce declarations and are collected", () => {
  const { declarations: found, comments } = scanCss("/* a{color:red} */ b{top:0/* mid */;left:0}");
  assert.deepEqual(found.map((d) => d.property), ["top", "left"]);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].text, " a{color:red} ");
});

test("a comment marker inside a string is not a comment", () => {
  const [declaration] = scanCss('a{content:"/* no */";color:red}').declarations;
  assert.equal(declaration.value, '"/* no */"');
});

test("semicolons and braces inside a data URI or string do not split a declaration", () => {
  const found = scanCss(`a{background:url(data:image/svg+xml;base64,AA{}A);color:red}b{content:"};{";top:0}`).declarations;
  assert.deepEqual(found.map((d) => d.property), ["background", "color", "content", "top"]);
});

test("escaped selector characters are skipped", () => {
  const found = scanCss(".w-1\\/2\\;x{width:50%}.md\\:a\\{{top:0}").declarations;
  assert.deepEqual(found.map((d) => d.property), ["width", "top"]);
});

test("a custom property holding braces is a value, not a block", () => {
  const found = scanCss("a{--x:{a:b};color:red}").declarations;
  assert.deepEqual(found.map((d) => [d.property, d.selector]), [["--x", "a"], ["color", "a"]]);
});

test("broken CSS does not throw and later rules still read", () => {
  assert.deepEqual(declarations("a{color:rgb(0,0;}b{top:0}"), [["color", "rgb(0,0;"], ["top", "0"]]);
  assert.deepEqual(declarations('a{content:"open\n;top:0}'), [["content", '"open'], ["top", "0"]]);
  assert.deepEqual(declarations("a{color:red"), [["color", "red"]]);
  assert.deepEqual(declarations("}}}a{top:0}"), [["top", "0"]]);
  assert.deepEqual(declarations("/* never closed"), []);
});

test("reads !important off the value", () => {
  const [declaration] = scanCss("a{color:red ! IMPORTANT}").declarations;
  assert.equal(declaration.value, "red");
  assert.equal(declaration.important, true);
});

test("hacks and junk are not treated as declarations", () => {
  assert.deepEqual(declarations("a{*zoom:1;nonsense;:b;top:0}"), [["top", "0"]]);
});

test("reads @import statements in each form", () => {
  const { statements } = scanCss('@import url("a.css") screen;@import "b.css";@import url(c.css);@charset "utf-8";');
  assert.deepEqual(statements.filter((s) => s.name === "import").map(importTarget), ["a.css", "b.css", "c.css"]);
});

test("finds url() references in every quoting style", () => {
  assert.deepEqual(findUrls(`url(a.png), url("b.png"), url( 'c d.png' )`).map((u) => u.url), ["a.png", "b.png", "c d.png"]);
});

test("blanking keeps offsets", () => {
  const value = 'url(a) "b" red';
  assert.equal(blankStringsAndUrls(value).length, value.length);
  assert.equal(blankStringsAndUrls(value).trim(), "red");
});

const PURE = {
  black: [
    "#000", "#000000", "#000F", "#000000ff", "black", "BLACK", "rgb(0,0,0)", "rgb(0 0 0)", "rgba(0,0,0,1)",
    "rgb(0 0 0 / 100%)", "rgb(0%,0%,0%)", "hsl(0,0%,0%)", "hsl(120 100% 0%)", "hsla(0,0%,0%,1)", "hwb(0 0% 100%)",
    "oklch(0 0 0)", "oklch(0% 0 0)", "lch(0 0 0)", "oklab(0 0 0)", "lab(0% 0 0)", "color(srgb 0 0 0)",
  ],
  white: [
    "#fff", "#FFF", "#ffffff", "#FFFFFF", "#ffff", "#ffffffff", "white", "rgb(255,255,255)", "rgb(255 255 255)",
    "rgb(100%,100%,100%)", "hsl(0,0%,100%)", "hsl(200 50% 100%)", "hwb(0 100% 0%)", "oklch(1 0 0)", "oklch(100% 0 0)",
    "lch(100 0 0)", "oklab(1 0 0)", "lab(100 0 0)", "color(srgb 1 1 1)",
  ],
};

for (const [color, values] of Object.entries(PURE)) {
  for (const value of values) {
    test(`${value} is pure ${color}`, () => {
      assert.deepEqual(findPureColors(value).map((found) => found.color), [color]);
    });
  }
}

const NOT_PURE = [
  "#111", "#001", "#0000", "#00000000", "#ffffff80", "#fff0", "#fffffe", "rgba(0,0,0,.5)", "rgb(0 0 0 / 40%)",
  "rgba(255,255,255,0)", "hsl(0,0%,50%)", "hsla(0,0%,100%,.5)", "oklch(0.2 0 0)", "oklch(1 0.1 20)", "oklch(0 0 0 / 0.5)",
  "rgb(from red r g b)", "transparent", "currentColor", "off-white", "white-space", "black-box", "var(--white)",
  "--black", "url(white.png)", 'url("#000")', '"#000 black"', "whitesmoke", "color(srgb 0.5 0.5 0.5)", "#gggggg",
];

for (const value of NOT_PURE) {
  test(`${value} is not reported as pure`, () => {
    assert.deepEqual(findPureColors(value), []);
  });
}

test("finds each pure color in a compound value at its own index", () => {
  const found = findPureColors("linear-gradient(#000, white 50%, #fff)");
  assert.deepEqual(found.map((f) => f.text), ["#000", "white", "#fff"]);
  assert.equal(found[1].index, "linear-gradient(#000, ".length);
});

test("reads a font stack, with quotes, in order", () => {
  assert.deepEqual(familiesFromDeclaration("font-family", `"Open Sans", Inter , sans-serif`), ['"Open Sans"', "Inter", "sans-serif"]);
});

test("reads families out of the font shorthand", () => {
  assert.deepEqual(familiesFromDeclaration("font", "italic 700 1rem/1.2 Inter, serif"), ["Inter", "serif"]);
  assert.deepEqual(familiesFromDeclaration("font", "12px Roboto"), ["Roboto"]);
  assert.equal(familiesFromDeclaration("font", "inherit"), null);
});

test("font custom properties count, other properties do not", () => {
  assert.deepEqual(familiesFromDeclaration("--font-display", "Inter, serif"), ["Inter", "serif"]);
  assert.equal(familiesFromDeclaration("--spacing", "Inter"), null);
  assert.equal(familiesFromDeclaration("color", "Inter"), null);
});

test("normalizes family names", () => {
  assert.equal(normalizeFamily(`"Inter Variable"`), "inter");
  assert.equal(normalizeFamily(`'Open  Sans'`), "open sans");
  assert.equal(normalizeFamily("Inter Tight"), "inter tight");
  assert.equal(normalizeFamily("Roboto Mono"), "roboto mono");
});

test("reads families from web font URLs", () => {
  assert.deepEqual(
    familiesFromWebFontUrl("https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&family=Inter&display=swap"),
    ["Open Sans", "Inter"],
  );
  assert.deepEqual(familiesFromWebFontUrl("//fonts.googleapis.com/css?family=Roboto:400|Lato"), ["Roboto", "Lato"]);
  assert.deepEqual(familiesFromWebFontUrl("https://example.com/css?family=Inter"), []);
});
