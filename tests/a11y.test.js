// Accessibility rules: what each one reports, what it leaves alone, and the markup in between
// that a careless check gets wrong.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { ConfigError, resolveConfig } from "../src/engine/config.js";
import { allRules } from "../src/rules/index.js";
import { autocompleteProblem } from "../src/a11y/autocomplete.js";
import { parseRefresh } from "../src/rules/a11y.js";
import { REPO_ROOT, findingsFor, page, withFixtureSite, withSite } from "./helpers.js";

// Findings of one rule for one page body, as "line: message".
function check(rule, body, { head = "", config = {}, files = {} } = {}) {
  return findingsFor({ "index.html": page(body, head), ...files }, rule, config).map((finding) => `${finding.line}: ${finding.message}`);
}

function count(rule, body, options) {
  return check(rule, body, options).length;
}

function lines(...rows) {
  return rows.join("\n");
}

// ---- a11y/image-alt

test("image-alt reports images, image buttons and linked areas with no alt", () => {
  const found = check("a11y/image-alt", lines(
    '<img src="/a.png">',
    '<img src="/b.png" alt="">',
    '<img src="/c.png" alt="A loaf">',
    '<input type="image" src="/go.png">',
    '<input type="image" src="/go.png" alt="Search">',
    '<map name="m"><area href="/x" shape="rect" coords="0,0,1,1"><area href="/y" alt="Yards"><area shape="rect" nohref></map>',
  ));
  assert.equal(found.length, 3);
  assert.match(found[0], /^1: Image \/a\.png has no alt attribute\. Describe it in alt, or write alt="" if it is decorative$/);
  assert.match(found[1], /^4: Image button <input type="image" src="\/go\.png"> has no alt text/);
  assert.match(found[2], /^6: Image map area linking to \/x has no alt text$/);
});

test("image-alt accepts presentation roles and other names, and skips what is never announced", () => {
  assert.equal(count("a11y/image-alt", lines(
    '<img src="/a.png" role="presentation"><img src="/a.png" role="none">',
    '<img src="/a.png" aria-label="A loaf"><span id="cap">Rye</span><img src="/a.png" aria-labelledby="cap">',
    '<div aria-hidden="true"><img src="/a.png"></div>',
    '<div hidden><img src="/a.png"></div>',
    '<div style="display: none"><img src="/a.png"></div>',
    '<template><img src="/a.png"></template>',
    '<noscript><img src="/pixel.gif"></noscript>',
    '<p class="gone"><img src="/a.png"></p>',
  ), { head: "<style>.gone{display:none}</style>" }), 0);
});

test("image-alt still checks images hidden only at some screen widths", () => {
  assert.equal(count("a11y/image-alt", '<p class="wide"><img src="/a.png"></p>', { head: "<style>.wide{display:none}@media (min-width: 800px){.wide{display:block}}</style>" }), 1);
});

test("an aria-label that is only whitespace is no name", () => {
  assert.equal(count("a11y/image-alt", '<img src="/a.png" aria-label="   ">'), 1);
});

// ---- a11y/placeholder-alt

test("placeholder-alt reports file names and placeholder words", () => {
  const found = check("a11y/placeholder-alt", lines(
    '<img src="/a.png" alt="hero-banner.jpg">',
    '<img src="/a.png" alt="IMG_2041">',
    '<img src="/img/team-photo-2.png" alt="team-photo-2">',
    '<img src="/a.png" alt="Image">',
    '<img src="/a.png" alt="photo.">',
    '<img src="/bread.jpg" alt="Bread">',
    '<img src="/a.png" alt="Photo of the bakery at dawn">',
    '<img src="/a.png" alt="">',
    '<img src="/a.png" alt="Photo 2024 team picnic">',
    '<img src="/a.png" alt="PXL_20260101_093000">',
  ));
  assert.deepEqual(found.map((line) => line.split(":")[0]), ["1", "2", "3", "4", "5", "10"]);
  assert.match(found[0], /Alt text "hero-banner\.jpg" is a file name, not a description of the image/);
  assert.match(found[2], /is the file name/);
  assert.match(found[3], /is a placeholder/);
});

test("placeholder-alt takes its own list of placeholders", () => {
  const config = { rules: { "a11y/placeholder-alt": { placeholders: ["Bild"] } } };
  assert.equal(count("a11y/placeholder-alt", '<img src="/a.png" alt="bild"><img src="/a.png" alt="image">', { config }), 1);
});

// ---- a11y/control-name

test("control-name reports fields with no name, and names come from every kind of label", () => {
  const found = check("a11y/control-name", lines(
    '<input type="text" name="q">',
    '<select name="size"><option>Small</option></select>',
    "<textarea></textarea>",
    '<div role="textbox" contenteditable></div>',
    '<label for="email">Email</label><input id="email" type="email">',
    '<label>Name <input type="text"></label>',
    '<label><span>Phone</span><input type="tel"></label>',
    '<input aria-label="Search" type="search">',
    '<span id="zip-label">Postal code</span><input aria-labelledby="zip-label">',
    '<input type="text" title="Coupon">',
    '<input type="text" placeholder="Your city">',
    '<div role="checkbox" aria-checked="false">Subscribe</div>',
    '<input type="hidden" name="token"><input type="submit"><input type="reset">',
  ));
  assert.equal(found.length, 4);
  assert.match(found[0], /^1: Form field <input type="text" name="q"> has no label\. Add a <label>, an aria-label or aria-labelledby$/);
  assert.match(found[3], /^4: Form field <div> has no label/);
});

test("a label wrapped around two fields labels only the first", () => {
  assert.deepEqual(check("a11y/control-name", '<label>Card <input type="text" name="a"> <input type="text" name="b"></label>').length, 1);
});

test("a label for an id that a later duplicate holds does not label the duplicate", () => {
  assert.equal(count("a11y/control-name", '<label for="x">X</label><input id="x"><input id="x">'), 1);
});

test("a hidden element pointed at by aria-labelledby still names the field", () => {
  assert.equal(count("a11y/control-name", '<span id="l" hidden>Quantity</span><input type="number" aria-labelledby="l">'), 0);
});

test("hidden text inside a label does not name the field", () => {
  assert.equal(count("a11y/control-name", '<label><span aria-hidden="true">*</span><input type="text"></label>'), 1);
});

test("allowPlaceholder set to false reports a field whose only name is its placeholder", () => {
  const config = { rules: { "a11y/control-name": { allowPlaceholder: false } } };
  const found = check("a11y/control-name", '<input type="email" placeholder="Email"><label>Name <input placeholder="Jane Doe"></label>', { config });
  assert.equal(found.length, 1);
  assert.match(found[0], /has only a placeholder \("Email"\), which disappears once someone types/);
});

test("control-name skips hidden fields and fields in templates", () => {
  assert.equal(count("a11y/control-name", '<div hidden><input type="text"></div><template><input type="text"></template><input type="text" aria-hidden="true" tabindex="-1">'), 0);
});

// ---- a11y/label-for

test("label-for reports labels for missing ids and for elements a label cannot label", () => {
  const found = check("a11y/label-for", lines(
    '<label for="emial">Email</label><input id="email">',
    '<label for="nowhere">Gone</label>',
    '<label for="box">Box</label><div id="box"></div>',
    '<label for="custom">Custom</label><date-picker id="custom"></date-picker>',
    '<label for="email">Email</label>',
    '<label for="">Empty</label>',
  ));
  assert.equal(found.length, 3);
  assert.match(found[0], /^1: <label for="emial"> names an id that is not on this page, so it labels nothing\. Did you mean "email"\?$/);
  assert.match(found[1], /^2: <label for="nowhere"> names an id that is not on this page, so it labels nothing\.$/);
  assert.match(found[2], /^3: <label for="box"> points at <div id="box">, which a label cannot label$/);
  assert.match(check("a11y/label-for", '<label for="t">T</label><input type="hidden" id="t">')[0], /points at <input type="hidden" id="t">/);
});

test("label-for accepts an id that only a template holds, and checks hidden labels", () => {
  assert.equal(count("a11y/label-for", '<label for="later">Later</label><template><input id="later"></template>'), 0);
  assert.equal(count("a11y/label-for", '<div hidden><label for="gone">Gone</label></div>'), 1);
  assert.equal(count("a11y/label-for", '<template><label for="gone">Gone</label></template>'), 0);
});

// ---- a11y/link-name and a11y/button-name

test("link-name reports icon-only links and accepts every way of naming one", () => {
  const found = check("a11y/link-name", lines(
    '<a href="https://social.example.com/bakery"><i class="icon-social"></i></a>',
    '<a href="/cart"><svg viewBox="0 0 1 1"><path d="M0 0"/></svg></a>',
    '<a href="/home"><img src="/logo.png" alt=""></a>',
    '<a href="/a">About</a>',
    '<a href="/b" aria-label="Basket"><i class="icon"></i></a>',
    '<a href="/c"><img src="/c.png" alt="Contact"></a>',
    '<a href="/d"><svg><title>Directions</title><path d="M0 0"/></svg></a>',
    '<a href="/e"><svg aria-label="Events"></svg></a>',
    '<a href="/f"><span class="sr-only">Facebook</span><i class="icon"></i></a>',
    '<a href="/g" title="Gallery"><i class="icon"></i></a>',
    '<span id="h">Help</span><a href="/h" aria-labelledby="h"></a>',
    '<a name="anchor"></a><a id="top"></a>',
  ));
  assert.equal(found.length, 3);
  assert.match(found[0], /^1: Link to https:\/\/social\.example\.com\/bakery has no text a screen reader can announce\. Add text, an aria-label, or alt text on its image$/);
  assert.match(found[1], /^2: Link to \/cart/);
  assert.match(found[2], /^3: Link to \/home/);
});

test("link-name does not count hidden text, and reports role=link elements", () => {
  const found = check("a11y/link-name", lines(
    '<a href="/x"><span aria-hidden="true">X</span></a>',
    '<a href="/y"><span hidden>Y</span></a>',
    '<span role="link" tabindex="0"></span>',
    '<a href="/z" role="button"></a>',
  ));
  assert.equal(found.length, 3);
  assert.match(found[2], /^3: <span> with role="link" has no text/);
});

test("a link whose image has no alt is reported once, by image-alt", () => {
  const files = { "index.html": page('<a href="/"><img src="/logo.png"></a>') };
  const both = findingsFor(files, "a11y/*").map((finding) => finding.rule);
  assert.deepEqual(both, ["a11y/image-alt"]);
  assert.equal(findingsFor(files, "a11y/link-name").length, 1);
});

test("link-name skips links inside SVG and links in hidden content", () => {
  assert.equal(count("a11y/link-name", '<svg><a href="/x"><path d="M0 0"/></a></svg><nav hidden><a href="/y"></a></nav><div aria-hidden="true"><a href="/z" tabindex="-1"></a></div>'), 0);
});

test("button-name reports icon-only buttons and input buttons with no value", () => {
  const found = check("a11y/button-name", lines(
    '<button class="menu-toggle"><svg><path d="M0 0"/></svg></button>',
    '<input type="button">',
    '<div role="button" tabindex="0"></div>',
    '<a href="#" role="button"></a>',
    "<button>Send</button>",
    '<button aria-label="Close">x</button>',
    '<button><img src="/x.png" alt="Close"></button>',
    '<input type="button" value="Go"><input type="submit"><input type="submit" value=""><input type="reset">',
    '<label for="b">Open</label><button id="b"></button>',
  ));
  assert.equal(found.length, 4);
  assert.match(found[0], /^1: Button <button class="menu-toggle"> has no text a screen reader can announce\. Add text or an aria-label$/);
  assert.match(found[1], /^2: Button <input type="button">/);
});

test("an SVG names its link or button by its title or its text, and shapes add nothing", () => {
  assert.equal(count("a11y/link-name", '<a href="/"><svg viewBox="0 0 10 10"><text x="0" y="9">Example Bakery</text></svg></a>'), 0);
  assert.equal(count("a11y/link-name", '<a href="/"><svg><desc>A wheat sheaf</desc><path d="M0 0"/></svg></a>'), 1);
  assert.equal(count("a11y/button-name", '<button title="Search"><svg><path d="M0 0"/></svg></button>'), 0);
  assert.equal(count("a11y/button-name", '<button><svg aria-hidden="true"><title>Hidden</title></svg></button>'), 1);
});

test("a name that is too deep to read is not reported as missing", () => {
  assert.equal(count("a11y/link-name", `<a href="/x">${"<span>".repeat(400)}Deep text</a>`), 0);
});

test("the text of a select or a text field inside a button counts toward its name", () => {
  assert.equal(count("a11y/button-name", '<div role="button"><select><option selected>Large</option></select></div>'), 0);
});

// ---- a11y/aria-reference and a11y/duplicate-id

test("aria-reference reports each id that is not on the page", () => {
  const found = check("a11y/aria-reference", lines(
    '<button aria-controls="menu" aria-expanded="false">Menu</button>',
    '<input aria-describedby="hint error" aria-label="Code"><p id="hint">Six digits</p>',
    '<div aria-labelledby="  "></div>',
    '<ul id="menu-list"></ul><button aria-owns="menu-list">x</button>',
  ));
  assert.equal(found.length, 2);
  assert.match(found[0], /^1: aria-controls on <button> names the id "menu", which is not on this page$/);
  assert.match(found[1], /^2: aria-describedby on <input> names the id "error"/);
});

test("aria-reference accepts template ids, skips templates and takes a list of attributes", () => {
  assert.equal(count("a11y/aria-reference", '<button aria-controls="dialog">Open</button><template><div id="dialog"></div></template><template><p aria-describedby="none"></p></template>'), 0);
  const config = { rules: { "a11y/aria-reference": { attributes: ["aria-labelledby"] } } };
  assert.equal(count("a11y/aria-reference", '<button aria-controls="nope">x</button><p aria-labelledby="nope2"></p>', { config }), 1);
  assert.throws(() => resolveConfig({ rules: { "a11y/aria-reference": { attributes: ["aria-label"] } } }, allRules), ConfigError);
});

test("an id is not an anchor name for ARIA", () => {
  assert.equal(count("a11y/aria-reference", '<a name="old"></a><p aria-describedby="old">x</p>'), 1);
});

test("duplicate-id reports an id that a label or reference depends on, once", () => {
  const found = check("a11y/duplicate-id", lines(
    '<label for="email">Email</label>',
    '<input id="email">',
    '<input id="email" aria-describedby="email">',
    '<div id="free"></div><div id="free"></div>',
  ));
  assert.equal(found.length, 1);
  assert.equal(found[0], '3: The id "email" is on 2 elements, and the for on line 1 depends on it. Only the first one, on line 2, counts');
});

test("duplicate-id leaves template copies alone", () => {
  assert.equal(count("a11y/duplicate-id", '<label for="a">A</label><input id="a"><template><input id="a"></template>'), 0);
});

// ---- a11y/aria-role and a11y/aria-attribute

test("aria-role reports unknown and abstract roles, and accepts fallbacks and extensions", () => {
  const found = check("a11y/aria-role", lines(
    '<div role="buton">x</div>',
    '<div role="widget">x</div>',
    '<div role="Navigation">x</div>',
    '<div role="switch checkbox">x</div>',
    '<div role="toggle button">x</div>',
    '<div role="doc-chapter">x</div><div role="graphics-document">x</div><div role="none">x</div>',
    '<div role="">x</div>',
  ));
  assert.equal(found.length, 2);
  assert.match(found[0], /^1: role="buton" on <div> is not a WAI-ARIA role, so it is ignored\. Did you mean "button"\?$/);
  assert.match(found[1], /^2: role="widget" on <div> is an abstract role/);
  const config = { rules: { "a11y/aria-role": { allowRoles: ["buton"] } } };
  assert.equal(count("a11y/aria-role", '<div role="buton">x</div>', { config }), 0);
});

test("aria-attribute reports misspelled attributes, at the attribute", () => {
  const found = findingsFor({ "index.html": page('<div aria-labeledby="a" aria-hidden="true" aria-description="d" aria-foo="1">x</div>') }, "a11y/aria-attribute");
  assert.equal(found.length, 2);
  assert.equal(found[0].message, "aria-labeledby is not an ARIA attribute, so it does nothing. Did you mean aria-labelledby?");
  assert.equal(found[1].message, "aria-foo is not an ARIA attribute, so it does nothing.");
  assert.ok(found[0].column > 1);
  const config = { rules: { "a11y/aria-attribute": { allowAttributes: ["aria-foo"] } } };
  assert.equal(count("a11y/aria-attribute", '<div aria-foo="1"></div>', { config }), 0);
});

// ---- a11y/hidden-focusable and a11y/positive-tabindex

test("hidden-focusable reports focusable content inside aria-hidden, once per hidden region", () => {
  const found = check("a11y/hidden-focusable", lines(
    '<div class="clone" aria-hidden="true">',
    '<a href="/next">Next</a>',
    "<button>Buy</button>",
    "</div>",
    '<a href="/x" aria-hidden="true">X</a>',
  ));
  assert.equal(found.length, 2);
  assert.equal(found[0], '1: aria-hidden="true" on <div class="clone"> hides 2 elements that can still take keyboard focus, such as the link "Next" on line 2. Add tabindex="-1" to them, or use inert instead of aria-hidden');
  assert.match(found[1], /^5: aria-hidden="true" on <a href="\/x"> hides an element that can still take keyboard focus: the link "X" on line 5/);
});

test("hidden-focusable accepts what cannot take focus", () => {
  assert.equal(count("a11y/hidden-focusable", lines(
    '<div aria-hidden="true">',
    '<a href="/a" tabindex="-1">A</a><a>no href</a><button disabled>B</button>',
    '<fieldset disabled><input type="text"></fieldset><input type="hidden">',
    '<div hidden><a href="/c">C</a></div><span>text</span><svg><path d="M0 0"/></svg>',
    "</div>",
    '<div aria-hidden="false"><a href="/d">D</a></div>',
    '<div aria-hidden="true" inert><a href="/e">E</a></div>',
  )), 0);
});

test("hidden-focusable counts tabindex, contenteditable, summary and media controls", () => {
  const found = check("a11y/hidden-focusable", '<div aria-hidden="true"><span tabindex="0">a</span><p contenteditable>b</p><details><summary>c</summary></details><video controls src="/v.mp4"></video></div>');
  assert.match(found[0], /hides 4 elements/);
});

test("positive-tabindex reports tabindex above 0, read the way HTML reads it", () => {
  const found = check("a11y/positive-tabindex", '<a href="/a" tabindex="3">A</a>\n<input tabindex=" 2x">\n<div tabindex="0"></div><div tabindex="-1"></div><div tabindex="x"></div>');
  assert.equal(found.length, 2);
  assert.match(found[0], /^1: tabindex="3" on <a href="\/a"> makes keyboard focus jump out of reading order/);
  assert.match(found[1], /^2: tabindex="2"/);
});

// ---- a11y/heading-order

test("heading-order reports a skipped level once, and allows going back up", () => {
  const found = check("a11y/heading-order", "<h1>Bakery</h1>\n<h2>Bread</h2>\n<h4>Rye</h4>\n<h4>Spelt</h4>\n<h2>Cakes</h2>\n<h3>Sponge</h3>\n<h1>Visit</h1>\n<h3>Hours</h3>");
  assert.deepEqual(found, [
    '3: Heading "Rye" skips from h2 to h4. Use the next level down, and style it as you like',
    '8: Heading "Hours" skips from h1 to h3. Use the next level down, and style it as you like',
  ]);
});

test("heading-order starts anywhere, skips hidden and empty headings, and counts screen reader only ones", () => {
  assert.equal(count("a11y/heading-order", "<h3>Start</h3><h4>Next</h4>"), 0);
  assert.equal(count("a11y/heading-order", '<h2>A</h2><h3 hidden>Hidden</h3><h4>B</h4>'), 1);
  assert.equal(count("a11y/heading-order", "<h2>A</h2><h3></h3><h4>B</h4>"), 1);
  assert.equal(count("a11y/heading-order", '<h2>A</h2><h3 class="sr-only">For screen readers</h3><h4>B</h4>', { head: "<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}</style>" }), 0);
  assert.equal(count("a11y/heading-order", '<h2>A</h2><h3 class="mobile">Menu</h3><h4>B</h4>', { head: "<style>@media (min-width: 900px){.mobile{display:none}}</style>" }), 0);
});

test("heading-order reads aria-level and role=heading, and ignores headings with another role", () => {
  const found = check("a11y/heading-order", '<h2>A</h2>\n<div role="heading" aria-level="4">B</div>\n<h2>C</h2>\n<h4 role="presentation">D</h4>\n<h2 aria-level="3">E</h2>');
  assert.equal(found.length, 1);
  assert.match(found[0], /^2: Heading "B" skips from h2 to level 4/);
});

// ---- a11y/frame-title

test("frame-title reports frames with no title, and skips hidden tracking frames", () => {
  const found = check("a11y/frame-title", lines(
    '<iframe src="https://maps.example.com/embed"></iframe>',
    '<iframe src="/x" title="  "></iframe>',
    '<iframe src="/y" title="Map of the bakery"></iframe>',
    '<iframe src="/z" aria-label="Booking form"></iframe>',
    '<noscript><iframe src="https://tags.example.com/ns.html" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>',
    '<iframe src="/w" aria-hidden="true" tabindex="-1"></iframe>',
  ));
  assert.equal(found.length, 2);
  assert.match(found[0], /^1: <iframe src="https:\/\/maps\.example\.com\/embed"> has no title\. Add a title that says what it shows/);
});

// ---- a11y/video-captions and a11y/autoplay-audio

test("video-captions reports videos without a captions or subtitles track", () => {
  const found = check("a11y/video-captions", lines(
    '<video src="/intro.mp4" controls></video>',
    '<video controls><source src="/a.mp4"><track kind="chapters" src="/c.vtt"></video>',
    '<video controls><source src="/b.mp4"><track kind="captions" src="/b.vtt" srclang="en"></video>',
    '<video controls src="/c.mp4"><track src="/c.vtt" srclang="en"></video>',
    '<video controls src="/d.mp4"><track kind="CAPTIONS" src="/d.vtt"></video>',
    '<video src="/loop.mp4" autoplay muted loop playsinline></video>',
    '<video class="player" data-src="/e.mp4"></video>',
    '<video controls src="/f.mp4"><track kind="nonsense" src="/f.vtt"></video>',
  ));
  assert.deepEqual(found.map((line) => line.split(":")[0]), ["1", "2", "8"]);
  assert.match(found[0], /<video src="\/intro\.mp4"> has no captions track\. Add <track kind="captions"> for people who cannot hear it/);
});

test("video-captions options change which tracks count and whether muted videos are checked", () => {
  const strict = { rules: { "a11y/video-captions": { trackKinds: ["captions"], ignoreMuted: false } } };
  assert.equal(count("a11y/video-captions", '<video src="/a.mp4"><track src="/a.vtt"></video><video src="/b.mp4" muted></video>', { config: strict }), 2);
  assert.throws(() => resolveConfig({ rules: { "a11y/video-captions": { trackKinds: ["caption"] } } }, allRules), /not a track kind/);
});

test("autoplay-audio reports media that plays sound by itself, even when hidden", () => {
  const found = check("a11y/autoplay-audio", lines(
    '<audio src="/jingle.mp3" autoplay></audio>',
    '<video src="/a.mp4" autoplay></video>',
    '<div hidden><audio src="/b.mp3" autoplay></audio></div>',
    '<video src="/c.mp4" autoplay muted></video>',
    '<audio src="/d.mp3" autoplay controls></audio>',
    '<audio src="/e.mp3" controls></audio>',
    '<template><audio src="/f.mp3" autoplay></audio></template>',
  ));
  assert.deepEqual(found.map((line) => line.split(":")[0]), ["1", "2", "3"]);
  assert.match(found[0], /<audio src="\/jingle\.mp3"> plays sound by itself, with no controls to stop it\. Add muted, or let people start it/);
  const config = { rules: { "a11y/autoplay-audio": { allowWithControls: false } } };
  assert.equal(count("a11y/autoplay-audio", '<audio src="/d.mp3" autoplay controls></audio>', { config }), 1);
});

// ---- a11y/html-lang

test("html-lang reports a missing lang attribute, and leaves its value to other checks", () => {
  const missing = findingsFor({ "index.html": "<!doctype html><html><head><title>T</title></head><body><p>x</p></body></html>" }, "a11y/html-lang");
  assert.equal(missing.length, 1);
  assert.equal(missing[0].message, "The html element has no lang attribute, so screen readers may read the page in the wrong language");
  assert.equal(findingsFor({ "index.html": "<html lang=\"\"><body>x</body></html>" }, "a11y/html-lang").length, 0);
  assert.equal(findingsFor({ "index.html": '<html xml:lang="en"><body>x</body></html>' }, "a11y/html-lang").length, 0);
  assert.equal(findingsFor({ "index.html": "<title>T</title><body><p>No html tag</p></body>" }, "a11y/html-lang").length, 1);
});

test("html-lang skips redirect stubs and files that are not documents", () => {
  assert.equal(findingsFor({
    "old.html": '<!doctype html><title>Redirecting</title><meta http-equiv="refresh" content="0;url=/new/">',
    "google0123456789abcdef.html": "google-site-verification: google0123456789abcdef.html",
    "index.html": page("x"),
  }, "a11y/html-lang").length, 0);
});

// ---- a11y/main-landmark

test("main-landmark reports a second visible main", () => {
  const found = check("a11y/main-landmark", "<main><p>One</p></main>\n<main><p>Two</p></main>\n<main hidden><p>Three</p></main>");
  assert.deepEqual(found, ["2: The page has 2 visible main landmarks, and this is the second; the first is on line 1. A page has one"]);
  assert.equal(count("a11y/main-landmark", '<main><p>One</p></main><div role="main"><p>Two</p></div>'), 1);
  assert.equal(count("a11y/main-landmark", '<div class="mobile"><main>A</main></div><div class="desktop"><main>B</main></div>', { head: "<style>.mobile{display:none}@media (max-width: 600px){.mobile{display:block}.desktop{display:none}}</style>" }), 0);
});

test("main-landmark reports navigation with no way past it", () => {
  const found = check("a11y/main-landmark", '<nav><a href="/">Home</a><a href="/menu">Menu</a></nav>\n<p>Fresh bread every morning.</p>');
  assert.equal(found.length, 1);
  assert.match(found[0], /^1: The page has navigation but no <main> element, heading or skip link after it/);
  assert.match(check("a11y/main-landmark", '<header><a href="/">Home</a></header><p>Text</p>')[0], /has a <header> block but no <main>/);
});

test("main-landmark accepts a heading or a skip link as a way past the navigation", () => {
  assert.equal(count("a11y/main-landmark", '<nav><a href="/">Home</a></nav><h1>Bread</h1><p>Text</p>'), 0);
  assert.equal(count("a11y/main-landmark", '<a href="#content">Skip</a><nav><a href="/">Home</a></nav><div id="content"><p>Text</p></div>'), 0);
  assert.equal(count("a11y/main-landmark", '<nav><a href="/">Home</a></nav>'), 0);
  assert.equal(count("a11y/main-landmark", '<article><header><h2>Post</h2></header></article><p>Text</p>'), 0);
  assert.equal(count("a11y/main-landmark", "<h1>No landmarks at all</h1><p>Text</p>"), 0);
});

test("requireMain reports every page with text and no main", () => {
  const config = { rules: { "a11y/main-landmark": { requireMain: true } } };
  assert.deepEqual(check("a11y/main-landmark", "<h1>Bread</h1>", { config }), ["1: The page has no <main> element. Wrap the main content in <main> so screen reader users can jump to it"]);
  assert.equal(count("a11y/main-landmark", '<div id="root"></div><script src="/app.js"></script>', { config }), 0);
});

// ---- a11y/table-headers and a11y/th-scope

test("table-headers reports data tables with no header cells", () => {
  const found = check("a11y/table-headers", lines(
    "<table><tr><td>Rye</td><td>4</td></tr><tr><td>Spelt</td><td>5</td></tr></table>",
    "<table><tr><th>Bread</th><th>Price</th></tr><tr><td>Rye</td><td>4</td></tr></table>",
    '<table><tr><td role="columnheader">Bread</td><td>Price</td></tr><tr><td>Rye</td><td>4</td></tr></table>',
    '<table role="presentation"><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
    "<table><tr><td>Only</td><td>one row</td></tr></table>",
    "<table><tr><td>One</td></tr><tr><td>column</td></tr></table>",
    "<table><tr><td><table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></td><td>x</td></tr><tr><td>y</td><td>z</td></tr></table>",
  ));
  assert.deepEqual(found, ['1: Table with 2 rows and 2 columns has no header cells. Mark its headings with <th>, or add role="presentation" if it only lays out content']);
});

test("th-scope reports scope values that are not valid", () => {
  const found = check("a11y/th-scope", '<table><tr><th scope="column">A</th><th scope="COL">B</th><th scope="rowgroup">C</th><th scope="">D</th><th>E</th></tr></table>');
  assert.deepEqual(found, ['1: scope="column" on a header cell is not valid, so it is ignored. Use row, col, rowgroup or colgroup']);
});

// ---- a11y/autocomplete

test("the autocomplete grammar accepts valid token lists", () => {
  for (const value of ["on", "off", "email", "  EMAIL ", "shipping street-address", "section-blue billing postal-code", "work email", "section-a shipping mobile tel", "username webauthn", "cc-number", ""]) {
    assert.equal(autocompleteProblem(value), null, value);
  }
});

test("the autocomplete grammar explains what is wrong", () => {
  assert.match(autocompleteProblem("nope"), /"nope" is not an autocomplete field name/);
  assert.match(autocompleteProblem("on email"), /must stand alone/);
  assert.match(autocompleteProblem("email work"), /"work" cannot follow the field name "email"/);
  assert.match(autocompleteProblem("work postal-code"), /"work" goes only with a contact field/);
  assert.match(autocompleteProblem("billing"), /names no field/);
  assert.match(autocompleteProblem("email shipping"), /cannot follow/);
  assert.match(autocompleteProblem("given name"), /out of order|not an autocomplete/);
});

test("autocomplete reports invalid values on fields and forms, and skips types it does not apply to", () => {
  const found = check("a11y/autocomplete", lines(
    '<input type="email" autocomplete="nope">',
    '<form autocomplete="false"></form>',
    '<select autocomplete="country-name"><option>X</option></select>',
    '<input type="checkbox" autocomplete="nope"><input type="hidden" autocomplete="nope">',
    '<textarea autocomplete="street-address"></textarea><form autocomplete="off"></form>',
  ));
  assert.equal(found.length, 2);
  assert.match(found[0], /^1: autocomplete="nope" on <input type="email"> is not valid: "nope" is not an autocomplete field name$/);
  assert.match(found[1], /^2: autocomplete="false" on <form> is not valid: a form takes only "on" or "off"$/);
  const config = { rules: { "a11y/autocomplete": { allowValues: ["Nope"] } } };
  assert.equal(count("a11y/autocomplete", '<input autocomplete="nope">', { config }), 0);
});

// ---- a11y/meta-refresh

test("meta refresh content is read the way HTML reads it", () => {
  assert.deepEqual(parseRefresh("5; url=/new/"), { delay: 5, url: "/new/" });
  assert.deepEqual(parseRefresh("5,URL='/new/'"), { delay: 5, url: "/new/" });
  assert.deepEqual(parseRefresh("3 /next"), { delay: 3, url: "/next" });
  assert.deepEqual(parseRefresh("30"), { delay: 30, url: null });
  assert.deepEqual(parseRefresh("2.5; url=/x"), { delay: 2, url: "/x" });
  assert.equal(parseRefresh("soon"), null);
});

test("meta-refresh reports delayed redirects and timed reloads", () => {
  const found = findingsFor({
    "a.html": '<!doctype html><html lang="en"><head><meta http-equiv="refresh" content="5; url=/new/"></head><body>Moved</body></html>',
    "b.html": '<!doctype html><html lang="en"><head><meta http-equiv="Refresh" content="30"></head><body>Scores</body></html>',
    "c.html": '<!doctype html><html lang="en"><head><meta http-equiv="refresh" content="0; url=/new/"></head><body>Moved</body></html>',
    "d.html": '<!doctype html><html lang="en"><head><meta http-equiv="refresh" content="86400"></head><body>Daily</body></html>',
    "new/index.html": page("x"),
  }, "a11y/meta-refresh");
  assert.deepEqual(found.map((finding) => `${finding.file}: ${finding.message}`), [
    "a.html: The page moves people to /new/ after 5 seconds, which may be before they have read it. Redirect at once with a delay of 0, or link to the new page",
    "b.html: The page reloads itself every 30 seconds, which interrupts screen readers and loses the reader's place. Let people reload it themselves",
  ]);
  const config = { rules: { "a11y/meta-refresh": { checkReload: false } } };
  assert.equal(findingsFor({ "b.html": '<meta http-equiv="refresh" content="30">' }, "a11y/meta-refresh", config).length, 0);
});

// ---- ignoreSelectors, suppression and configuration

test("ignoreSelectors skips matching elements and everything inside them", () => {
  const config = { rules: { "a11y/link-name": { ignoreSelectors: ["#chat-widget", ".embed a"] } } };
  assert.equal(count("a11y/link-name", '<div id="chat-widget"><a href="/x"></a></div><div class="embed"><a href="/y"></a></div><a href="/z"></a>', { config }), 1);
});

test("an ignoreSelectors entry this tool cannot read is a config error", () => {
  assert.throws(() => resolveConfig({ rules: { "a11y/image-alt": { ignoreSelectors: ["a[href"] } } }, allRules), /is not a selector this tool can read/);
  assert.throws(() => resolveConfig({ rules: { "a11y/image-alt": { ignoreSelectors: ["p::before"] } } }, allRules), ConfigError);
  assert.throws(() => resolveConfig({ rules: { "a11y/image-alt": { ignoreSelectors: "#x" } } }, allRules), ConfigError);
});

test("ignore comments and attributes apply to accessibility findings", () => {
  const body = '<!-- builtcheck-ignore-next-element a11y/image-alt --><img src="/a.png"><div data-builtcheck-ignore="a11y/*"><img src="/b.png"></div><img src="/c.png">';
  const result = withSite({ "index.html": page(body) }, (root) => audit(root, { rules: { "*": "off", "a11y/*": "error" } }));
  assert.equal(result.findings.length, 1);
  assert.equal(result.summary.suppressed, 2);
});

test("every accessibility rule is quiet on a well-built page", () => {
  const body = lines(
    '<a class="skip" href="#main">Skip to content</a>',
    '<header><nav aria-label="Main"><a href="/"><img src="/logo.svg" alt="Example Bakery"></a><a href="/menu">Menu</a>',
    '<button aria-expanded="false" aria-controls="more"><svg aria-hidden="true"><path d="M0 0"/></svg><span class="sr-only">More</span></button>',
    '<ul id="more" hidden><li><a href="/about">About</a></li></ul></nav></header>',
    '<main id="main"><h1>Fresh bread</h1><img src="/loaf.png" alt="A round rye loaf on a board">',
    '<img src="/divider.png" alt=""><h2>Order</h2>',
    '<form><label for="name">Name</label><input id="name" autocomplete="name">',
    '<label>Email <input type="email" autocomplete="email" aria-describedby="email-hint"></label><p id="email-hint">We reply within a day.</p>',
    '<fieldset><legend>Size</legend><label><input type="radio" name="s"> Small</label></fieldset>',
    '<select aria-label="Pickup day"><option>Monday</option></select><button>Send</button></form>',
    '<h2>Prices</h2><table><caption>Prices</caption><tr><th scope="col">Bread</th><th scope="col">Price</th></tr><tr><td>Rye</td><td>4</td></tr></table>',
    '<iframe src="https://maps.example.com/embed" title="Map of the bakery"></iframe>',
    '<video controls src="/tour.mp4"><track kind="captions" src="/tour.vtt" srclang="en"></video>',
    '<video autoplay muted loop src="/steam.mp4"></video>',
    '<div class="carousel-clone" aria-hidden="true"><a href="/menu" tabindex="-1">Menu</a></div>',
    "</main><footer><p>Example Bakery</p></footer>",
  );
  const head = "<style>.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}</style>";
  const files = { "index.html": page(body, head), "logo.svg": "<svg/>", "loaf.png": "x", "divider.png": "x", "tour.mp4": "x", "tour.vtt": "x", "steam.mp4": "x" };
  assert.deepEqual(findingsFor(files, "a11y/*").map((finding) => `${finding.rule} ${finding.line}: ${finding.message}`), []);
});

test("the clean fixture site and the improved example have no accessibility findings", () => {
  const clean = withFixtureSite("clean-site", (root) => audit(root, { rules: { "*": "off", "a11y/*": "error" } }));
  assert.deepEqual(clean.findings, []);
  const after = audit(join(REPO_ROOT, "examples", "after"), { rules: { "*": "off", "a11y/*": "error" } });
  assert.deepEqual(after.findings, []);
});

test("accessibility rules run from the command line and name themselves", () => {
  withSite({ "index.html": page('<a href="/x"><i class="icon"></i></a>') }, (root) => {
    const { stdout, status } = spawnSync(process.execPath, [join(REPO_ROOT, "bin", "builtcheck.js"), root, "--no-config", "--only", "a11y/*", "--format", "json"], { encoding: "utf8" });
    assert.equal(status, 1);
    const findings = JSON.parse(stdout).findings;
    assert.deepEqual(findings.map((finding) => finding.rule), ["a11y/link-name"]);
  });
});

// ---- Hostile markup stays fast

test("deeply nested and repeated markup gives an answer promptly", () => {
  const R = (times, text) => text.repeat(times);
  const sites = {
    "nested buttons": page(R(20000, '<div role="button">')),
    "nested labels": page(R(20000, "<label><input>")),
    "nested tables": page(R(5000, "<table><tr><td>")),
    "nested aria-hidden links": page(R(20000, '<div aria-hidden="true"><a href="/x">')),
    "nested fieldsets": page(R(20000, "<fieldset disabled><input>")),
    "a flood of references": page(`${R(20000, '<p aria-describedby="a b c d e">x</p>')}${R(5000, '<p id="a">a</p>')}`),
    "long attribute names": page(`<div ${Array.from({ length: 2000 }, (_, i) => `aria-${"x".repeat(60)}${i}`).join(" ")}></div>`),
    "nested videos": page(R(20000, '<video src="/a.mp4">')),
    "a table of many rows": page(`<table>${R(150000, "<tr><td>a<td>b")}</table>`),
    "a flood of mistyped labels": page(`${Array.from({ length: 5000 }, (_, i) => `<input id="f${i}">`).join("")}${R(20000, '<label for="f99999">x</label>')}${R(20000, '<label for="x">a</label>')}<input id="x">`),
  };
  for (const [name, html] of Object.entries(sites)) {
    const started = Date.now();
    const result = withSite({ "index.html": html }, (root) => audit(root, { rules: { "*": "off", "a11y/*": "error" } }));
    assert.ok(Date.now() - started < 15000, `${name} took ${Date.now() - started}ms`);
    assert.deepEqual(result.skipped.filter((entry) => entry.incomplete), [], name);
  }
});
