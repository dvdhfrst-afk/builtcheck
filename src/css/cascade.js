// Works out which CSS declarations reach an element on one page: the stylesheets the page
// loads, in order, then selector matching, media queries, layers, specificity and !important.
//
// It answers for one element and one property, with no inheritance and no shorthand expansion.
// Declarations that apply only sometimes (inside a width media query, or on :hover) are kept
// apart from those that always apply, since a static file cannot choose between them.

import { getAttr } from "../html/tree.js";
import { importTarget } from "./scanner.js";
import { compareSpecificity, matchesSelector, parseSelectorList, resolveNesting, selectorKey, subjectNames } from "./selectors.js";
import { resolveReference, baseUrlForFile } from "../site/urls.js";

// At-rules whose blocks hold something other than rules for elements.
const NOT_ELEMENT_RULES = /^@(?:-\w+-)?(?:keyframes|font-face|page|property|counter-style|font-feature-values|font-palette-values|view-transition|position-try)\b/i;

// always: applies to any screen. never: cannot apply to a screen. sometimes: depends on the
// width, a user preference or the container.
export function mediaQueryState(query) {
  const text = query.toLowerCase().trim();
  if (text === "") return "always";
  const states = text.split(",").map((one) => {
    const part = one.trim();
    if (/^(?:only\s+)?(?:all|screen)$/.test(part) || part === "not print" || part === "not speech") return "always";
    if (/^(?:only\s+)?(?:print|speech)\b/.test(part) || part === "not all" || part === "not screen") return "never";
    return "sometimes";
  });
  if (states.includes("always")) return "always";
  return states.includes("sometimes") ? "sometimes" : "never";
}

function atRuleState(atRule) {
  const match = /^@([\w-]+)\s*(.*)$/s.exec(atRule);
  if (!match) return "sometimes";
  const name = match[1].toLowerCase();
  if (name === "media") return mediaQueryState(match[2]);
  if (name === "layer") return "always";
  if (name === "supports") return /\bnot\b/i.test(match[2]) ? "sometimes" : "always";
  if (name === "starting-style") return "never";
  return "sometimes";
}

function combinedState(states) {
  if (states.includes("never")) return "never";
  return states.includes("sometimes") ? "sometimes" : "always";
}

const compiledSources = new WeakMap();

// Turns the declarations of one CSS source into rules indexed by property, then by the rightmost
// part of their selector, since only a few properties are ever asked about. Each source is
// compiled once, however many pages load it.
function compileSource(source) {
  const known = compiledSources.get(source);
  if (known) return known;
  const byProperty = new Map();
  const bySubject = new Map();
  const layers = [];
  const addLayer = (name) => {
    if (!layers.includes(name)) layers.push(name);
  };
  for (const statement of source.statements) {
    if (statement.name === "layer") statement.prelude.split(",").forEach((name) => addLayer(name.trim()));
  }
  const blocks = new Map();
  source.declarations.forEach((declaration, position) => {
    if (declaration.selectorPath.length === 0) return;
    if (declaration.atRules.some((rule) => NOT_ELEMENT_RULES.test(rule))) return;
    let block = blocks.get(declaration.block);
    if (!block) {
      const state = combinedState(declaration.atRules.map(atRuleState));
      if (state === "never") {
        blocks.set(declaration.block, { skip: true });
        return;
      }
      const layerNames = declaration.atRules
        .filter((rule) => /^@layer\b/i.test(rule))
        .map((rule) => rule.replace(/^@layer\s*/i, "").trim() || `anonymous ${source.file} ${declaration.block}`);
      const layer = layerNames.length > 0 ? layerNames.join(".") : null;
      if (layer !== null) addLayer(layer);
      block = { state, layer, text: resolveNesting(declaration.selectorPath), declarations: [] };
      blocks.set(declaration.block, block);
    }
    if (!block.skip) block.declarations.push({ declaration, position });
  });
  for (const block of blocks.values()) {
    if (block.skip) continue;
    for (const complex of parseSelectorList(block.text)) {
      const entry = { complex, block };
      for (const name of subjectNames(complex)) {
        if (!bySubject.has(name)) bySubject.set(name, []);
        bySubject.get(name).push(entry);
      }
      const key = selectorKey(complex);
      for (const property of new Set(block.declarations.map(({ declaration }) => declaration.property))) {
        if (!byProperty.has(property)) byProperty.set(property, { byKey: new Map(), universal: [] });
        const index = byProperty.get(property);
        if (key === null) {
          index.universal.push(entry);
        } else {
          if (!index.byKey.has(key)) index.byKey.set(key, []);
          index.byKey.get(key).push(entry);
        }
      }
    }
  }
  const compiled = { byProperty, bySubject, layers };
  compiledSources.set(source, compiled);
  return compiled;
}

function isStylesheetLink(link) {
  const rels = (getAttr(link, "rel") ?? "").toLowerCase().split(/\s+/);
  return rels.includes("stylesheet") && !rels.includes("alternate") && getAttr(link, "disabled") === null;
}

function statementMedia(statement) {
  return statement.prelude.replace(/^\s*(?:url\([^)]*\)|"[^"]*"|'[^']*')\s*/i, "").replace(/\blayer(?:\([^)]*\))?\s*/i, "").trim();
}

export class PageStyles {
  constructor(page, site) {
    this.page = page;
    this.site = site;
    this.inline = new Map();
    this.hiding = new Map();
    this.sources = this.collectSources();
    this.layerRanks = new Map();
    for (const { compiled } of this.sources) {
      for (const name of compiled.layers) {
        if (!this.layerRanks.has(name)) this.layerRanks.set(name, this.layerRanks.size);
      }
    }
  }

  // The stylesheets and <style> blocks the page loads, in the order they apply.
  collectSources() {
    const { page, site } = this;
    const blocks = new Map();
    for (const source of page.styleSources) {
      if (source.kind === "block") blocks.set(source.element, source);
      else if (source.kind === "inline") this.inline.set(source.element, source);
    }
    const sources = [];
    const seen = new Set();
    const addSheet = (sheet, state) => {
      if (seen.has(sheet)) return;
      seen.add(sheet);
      const baseUrl = baseUrlForFile(sheet.file, site);
      for (const statement of sheet.statements) {
        if (statement.name !== "import") continue;
        const target = importTarget(statement);
        const imported = target ? this.findSheet(target, baseUrl) : null;
        const importState = combinedState([state, mediaQueryState(statementMedia(statement))]);
        if (imported && importState !== "never") addSheet(imported, importState);
      }
      sources.push({ source: sheet, compiled: compileSource(sheet), state });
    };
    for (const element of page.elements) {
      if (element.name !== "link" && element.name !== "style") continue;
      const state = mediaQueryState(getAttr(element, "media") ?? "");
      if (state === "never") continue;
      if (element.name === "style") {
        const block = blocks.get(element);
        if (block) sources.push({ source: block, compiled: compileSource(block), state });
      } else if (isStylesheetLink(element)) {
        const sheet = this.findSheet(getAttr(element, "href") ?? "", page.baseUrl);
        if (sheet) addSheet(sheet, state);
      }
    }
    return sources;
  }

  findSheet(url, baseUrl) {
    const resolved = resolveReference(url, baseUrl, this.site);
    if (resolved.kind !== "internal") return null;
    const found = this.site.lookup(resolved.path);
    return found?.file ? this.site.stylesheet(found.file) : null;
  }

  // Index entries for a property whose rightmost part fits this element, before checking the rest.
  candidates(element, property) {
    const found = [];
    let keys = null;
    this.sources.forEach(({ compiled, state }, sourceIndex) => {
      const index = compiled.byProperty.get(property);
      if (!index) return;
      if (keys === null) {
        keys = [element.name];
        const id = getAttr(element, "id");
        if (id) keys.push(`#${id}`);
        for (const name of (getAttr(element, "class") ?? "").split(/\s+/)) {
          if (name) keys.push(`.${name}`);
        }
      }
      for (const key of keys) {
        const entries = index.byKey.get(key);
        if (entries) for (const entry of entries) found.push({ entry, sourceIndex, state });
      }
      for (const entry of index.universal) found.push({ entry, sourceIndex, state });
    });
    return found;
  }

  // The declarations of one property that could reach an element, lowest priority first. Each
  // result has { property, value, important, conditional, source, declaration }.
  matchedDeclarations(element, property) {
    const results = [];
    for (const { entry, sourceIndex, state } of this.candidates(element, property)) {
      const { complex, block } = entry;
      if (complex.pseudoElement !== null || !matchesSelector(element, complex)) continue;
      const conditional = complex.conditional || block.state === "sometimes" || state === "sometimes";
      const layerRank = block.layer === null ? Infinity : this.layerRanks.get(block.layer);
      for (const { declaration, position } of block.declarations) {
        if (declaration.property !== property) continue;
        results.push({
          property: declaration.property,
          value: declaration.value,
          important: declaration.important,
          conditional,
          source: this.sources[sourceIndex].source,
          declaration,
          inline: false,
          layerRank,
          specificity: complex.specificity,
          order: sourceIndex * 1e7 + position,
        });
      }
    }
    const inline = this.inline.get(element);
    if (inline) {
      inline.declarations.forEach((declaration, position) => {
        if (declaration.property !== property) return;
        results.push({
          property: declaration.property,
          value: declaration.value,
          important: declaration.important,
          conditional: false,
          source: inline,
          declaration,
          inline: true,
          layerRank: Infinity,
          specificity: [0, 0, 0],
          order: position,
        });
      });
    }
    return results.sort(compareCascade);
  }

  // What the cascade gives for one property of one element. `winner` is the declaration that
  // always applies, or null. `sometimes` lists declarations that outrank it when they apply.
  cascaded(element, property) {
    const all = this.matchedDeclarations(element, property);
    let winner = null;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (!all[i].conditional) {
        winner = all[i];
        break;
      }
    }
    const sometimes = all.filter((entry) => entry.conditional && (winner === null || compareCascade(entry, winner) > 0));
    return { winner, sometimes };
  }

  // Rules aimed at this element by name that do not apply as the file stands, as in
  // ".panel.open { display: block }" on a plain .panel, where a script adds the class.
  hasUnmetRule(element, property, predicate) {
    const names = new Set();
    const id = getAttr(element, "id");
    if (id) names.add(`#${id}`);
    for (const name of (getAttr(element, "class") ?? "").split(/\s+/)) {
      if (name) names.add(`.${name}`);
    }
    if (names.size === 0) return false;
    for (const { compiled } of this.sources) {
      for (const name of names) {
        for (const { complex, block } of compiled.bySubject.get(name) ?? []) {
          if (complex.pseudoElement !== null) continue;
          if (matchesSelector(element, complex) && !complex.conditional) continue;
          if (block.declarations.some(({ declaration }) => declaration.property === property && predicate(declaration.value))) return true;
        }
      }
    }
    return false;
  }

  // "hidden" if a stylesheet always hides this element, "sometimes" if it does at some widths
  // or states, or null. The root elements do not count: pages hide them until a script runs.
  displayHiding(element) {
    if (element.name === "html" || element.name === "body" || element.name === "main") return null;
    const { winner, sometimes } = this.cascaded(element, "display");
    const isNone = (value) => value.trim().toLowerCase() === "none";
    const baseHidden = winner !== null && isNone(winner.value);
    if (baseHidden) {
      const shownSometimes = sometimes.some((entry) => !isNone(entry.value));
      if (shownSometimes || this.hasUnmetRule(element, "display", (value) => !isNone(value))) return "sometimes";
      return "hidden";
    }
    return sometimes.some((entry) => isNone(entry.value)) ? "sometimes" : null;
  }

  // What this element itself says about visibility: "hidden", "sometimes", "visible", or null
  // if it says nothing and inherits.
  ownVisibility(element) {
    if (element.name === "html" || element.name === "body" || element.name === "main") return "visible";
    const hides = (value) => /^(?:hidden|collapse)$/i.test(value.trim());
    const { winner, sometimes } = this.cascaded(element, "visibility");
    if (winner === null && sometimes.length === 0) return null;
    if (winner !== null && hides(winner.value)) {
      const shownSometimes = sometimes.some((entry) => !hides(entry.value));
      return shownSometimes || this.hasUnmetRule(element, "visibility", (value) => !hides(value)) ? "sometimes" : "hidden";
    }
    if (sometimes.some((entry) => hides(entry.value))) return "sometimes";
    return winner !== null ? "visible" : null;
  }

  // Hiding state of an element, built down from its ancestors and remembered, so a page of
  // many deep elements costs one visit per element.
  hidingState(element) {
    const chain = [];
    let node = element;
    while (node && node.type === "element" && !this.hiding.has(node)) {
      chain.push(node);
      node = node.parent;
    }
    let state = node && node.type === "element" ? this.hiding.get(node) : { always: false, sometimes: false, visibility: null };
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const display = this.displayHiding(chain[i]);
      state = {
        always: state.always || display === "hidden",
        sometimes: state.sometimes || display === "sometimes",
        visibility: this.ownVisibility(chain[i]) ?? state.visibility,
      };
      this.hiding.set(chain[i], state);
    }
    return state;
  }

  // Whether a stylesheet keeps this element from being seen at every width.
  isAlwaysHidden(element) {
    const { always, visibility } = this.hidingState(element);
    return always || visibility === "hidden";
  }

  // Whether it is hidden at some widths or states, which usually means a second copy of the
  // same content for another breakpoint. Always hidden counts too.
  isSometimesHidden(element) {
    const { always, sometimes, visibility } = this.hidingState(element);
    return always || sometimes || visibility === "hidden" || visibility === "sometimes";
  }
}

function compareCascade(a, b) {
  if (a.important !== b.important) return a.important ? 1 : -1;
  if (a.inline !== b.inline) return a.inline ? 1 : -1;
  if (a.layerRank !== b.layerRank) {
    // Among !important declarations the layer order turns around.
    return a.important ? b.layerRank - a.layerRank : a.layerRank - b.layerRank;
  }
  return compareSpecificity(a.specificity, b.specificity) || a.order - b.order;
}
