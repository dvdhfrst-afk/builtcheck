// Web app manifest rules: the manifest a page links with <link rel="manifest"> exists, is JSON,
// names the app, has icons that are really the sizes it says, keeps its start page and scope
// inside the site, and uses colors and a display mode browsers understand. Each manifest is
// checked once, however many pages link it.

import { isCssColor } from "../assets/css-color.js";
import { imageInfo } from "../assets/files.js";
import { firstTime, linkedDocuments } from "../assets/linked.js";
import { baseUrlForFile, resolveReference } from "../site/urls.js";

const isManifestLink = (element, rels) => rels.includes("manifest");

const manifests = new WeakMap();

// Reads a manifest once per run: { file, url, text, data, error }, or null if unreadable.
// `error` is { message, offset } when it is not JSON.
function readManifest(site, file) {
  if (!manifests.has(site)) manifests.set(site, new Map());
  const cache = manifests.get(site);
  if (cache.has(file)) return cache.get(file);
  const text = site.readText(file);
  let manifest = null;
  if (text !== null) {
    manifest = { file, url: baseUrlForFile(file, site), text, data: null, error: null };
    try {
      manifest.data = JSON.parse(text);
    } catch (error) {
      // Node gives the place as "at position N" or, in later versions, as a line and column.
      const position = /position (\d+)/.exec(error.message);
      manifest.error = { message: error.message.replace(/^JSON\.parse: /, ""), offset: position ? Number(position[1]) : null };
    }
  }
  cache.set(file, manifest);
  return manifest;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Where a member's value first appears in the file, to point a finding at it.
function offsetOf(manifest, key, value) {
  const needle = value === undefined ? JSON.stringify(key) : JSON.stringify(value);
  const at = manifest.text.indexOf(needle);
  return at === -1 ? null : at;
}

// A rule over every linked manifest that parses as a JSON object, or over every linked manifest
// at all when `raw` is set. `check(manifest, context)` runs once per manifest.
function manifestRule({ id, severity, description, options, validate, raw = false, check }) {
  return {
    id,
    severity,
    description,
    options,
    validate,
    page(page, context) {
      const { site } = context;
      for (const { file } of linkedDocuments(page, site, isManifestLink)) {
        if (!file || site.ignored(file) || !firstTime(context, file)) continue;
        const manifest = readManifest(site, file);
        if (manifest && (raw || isObject(manifest.data))) check(manifest, context);
      }
    },
  };
}

const manifestMissing = {
  id: "manifest/missing",
  severity: "error",
  description: "A page links a web app manifest that is not in the build.",
  page(page, context) {
    const { site, report } = context;
    for (const { element, href, missing, path } of linkedDocuments(page, site, isManifestLink)) {
      if (!missing || !firstTime(context, path)) continue;
      report({ file: page.file, offset: element.start, message: `Page links the web app manifest ${href}, which is not in the build` });
    }
  },
};

const manifestInvalid = manifestRule({
  id: "manifest/invalid",
  severity: "error",
  description: "A linked web app manifest is not valid JSON, or does not hold a JSON object.",
  raw: true,
  check(manifest, { report }) {
    if (manifest.error) {
      report({ file: manifest.file, offset: manifest.error.offset, message: `Web app manifest is not valid JSON, so browsers ignore it: ${manifest.error.message}` });
    } else if (!isObject(manifest.data)) {
      report({ file: manifest.file, message: "Web app manifest must hold a JSON object, so browsers ignore this one" });
    }
  },
});

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "";
}

const manifestName = manifestRule({
  id: "manifest/name",
  severity: "error",
  description: "A web app manifest has neither a name nor a short_name.",
  check(manifest, { report }) {
    const { data } = manifest;
    if (nonEmpty(data.name) || nonEmpty(data.short_name)) return;
    report({ file: manifest.file, message: "Web app manifest has no name or short_name, so an installed app has no label" });
  },
});

// The icon entries that are objects, with their place in the list.
function iconEntries(data) {
  return Array.isArray(data.icons) ? data.icons.map((icon, index) => ({ icon, index })).filter(({ icon }) => isObject(icon)) : [];
}

function declaredSizes(icon) {
  return typeof icon.sizes === "string" ? icon.sizes.trim().toLowerCase().split(/\s+/).filter(Boolean) : [];
}

const manifestIcons = manifestRule({
  id: "manifest/icons",
  severity: "error",
  description: "A web app manifest icon is not in the build, or is not the size it declares.",
  check(manifest, { site, report }) {
    if (manifest.data.icons !== undefined && !Array.isArray(manifest.data.icons)) {
      report({ file: manifest.file, offset: offsetOf(manifest, "icons"), message: "Web app manifest icons must be a list of icon objects" });
      return;
    }
    for (const { icon, index } of iconEntries(manifest.data)) {
      if (!nonEmpty(icon.src)) {
        report({ file: manifest.file, offset: offsetOf(manifest, "icons"), message: `Icon ${index + 1} in the web app manifest has no src` });
        continue;
      }
      const offset = offsetOf(manifest, null, icon.src);
      const resolved = resolveReference(icon.src, manifest.url, site);
      if (resolved.kind === "invalid") {
        report({ file: manifest.file, offset, message: `Icon ${icon.src} is not a valid URL` });
        continue;
      }
      if (resolved.kind !== "internal") continue;
      const target = site.lookup(resolved.path);
      if (target === null) {
        report({ file: manifest.file, offset, message: `Icon ${icon.src} is not in the build. Icon paths resolve against the manifest's own address` });
        continue;
      }
      const info = target.file ? imageInfo(site, target.file) : null;
      // A vector icon is every size, and an image this cannot read goes unmeasured.
      if (!info || info.vector) continue;
      const real = info.sizes ?? [{ width: info.width, height: info.height }];
      const actual = new Set(real.map(({ width, height }) => `${width}x${height}`));
      const wrong = declaredSizes(icon).filter((size) => size !== "any" && !actual.has(size));
      if (wrong.length > 0) {
        report({ file: manifest.file, offset, message: `Icon ${icon.src} declares ${wrong.join(" ")} but is ${[...actual].join(", ")}, so browsers scale the wrong image` });
      }
    }
  },
});

const APP_DISPLAY_MODES = new Set(["fullscreen", "standalone", "minimal-ui", "window-controls-overlay", "tabbed", "borderless"]);

// Whether the manifest asks to be installed as an app rather than to open in a browser tab.
function isInstallable(data) {
  const modes = [data.display, ...(Array.isArray(data.display_override) ? data.display_override : [])];
  return modes.some((mode) => typeof mode === "string" && APP_DISPLAY_MODES.has(mode.trim().toLowerCase()));
}

const manifestInstallIcons = manifestRule({
  id: "manifest/install-icons",
  severity: "warning",
  description: "A web app manifest that asks to be installed has no icon of each size browsers want.",
  options: { sizes: [192, 512] },
  validate(options) {
    if (!options.sizes.every((size) => Number.isInteger(size) && size > 0)) throw new Error("sizes must be a list of whole numbers of pixels");
  },
  check(manifest, { options, report }) {
    if (!isInstallable(manifest.data)) return;
    const declared = new Set();
    for (const { icon } of iconEntries(manifest.data)) {
      // Only icons for any purpose stand in for the app; maskable ones are cut to a shape.
      const purposes = typeof icon.purpose === "string" ? icon.purpose.toLowerCase().split(/\s+/) : ["any"];
      if (purposes.includes("any")) for (const size of declaredSizes(icon)) declared.add(size);
    }
    if (declared.has("any")) return;
    const missing = options.sizes.filter((size) => !declared.has(`${size}x${size}`));
    if (missing.length === 0) return;
    report({
      file: manifest.file,
      offset: offsetOf(manifest, "icons"),
      message: `Web app manifest declares no ${missing.map((size) => `${size}x${size}`).join(" or ")} icon, which browsers want to install the app and show its splash screen`,
    });
  },
});

// The path a scope or start_url names, or a problem with it.
function sitePath(value, manifest, site) {
  if (typeof value !== "string") return { problem: "is not a string" };
  const resolved = resolveReference(value === "" ? "." : value, manifest.url, site);
  if (resolved.kind === "invalid") return { problem: "is not a valid URL" };
  if (resolved.kind === "external") return site.ownHost === null ? {} : { problem: "is on another host, so browsers ignore it" };
  if (resolved.kind === "outside") return { problem: "is outside the base path of the site" };
  if (resolved.kind !== "internal") return { problem: "is not a web address" };
  return { path: resolved.path };
}

function withinScope(path, scope) {
  return path === scope || path.startsWith(scope.endsWith("/") ? scope : `${scope}/`) || (scope.endsWith("/") && `${path}/` === scope);
}

const manifestScope = manifestRule({
  id: "manifest/scope",
  severity: "error",
  description: "A web app manifest's start_url or scope leaves the site, start_url leads to no built page, or start_url is outside the scope.",
  check(manifest, { site, report }) {
    const { data } = manifest;
    const start = data.start_url === undefined ? null : sitePath(data.start_url, manifest, site);
    const scope = data.scope === undefined ? null : sitePath(data.scope, manifest, site);
    if (start?.problem) report({ file: manifest.file, offset: offsetOf(manifest, "start_url"), message: `Web app manifest start_url ${JSON.stringify(data.start_url)} ${start.problem}` });
    if (scope?.problem) report({ file: manifest.file, offset: offsetOf(manifest, "scope"), message: `Web app manifest scope ${JSON.stringify(data.scope)} ${scope.problem}` });
    if (start?.path && site.lookup(start.path) === null) {
      report({ file: manifest.file, offset: offsetOf(manifest, "start_url"), message: `Web app manifest start_url ${data.start_url} leads to no page in the build, so the installed app opens on an error` });
    }
    // Without a scope, it is the folder the manifest sits in.
    const scopePath = scope ? scope.path : resolveReference(".", manifest.url, site).path;
    if (start?.path && scopePath && !withinScope(start.path, scopePath)) {
      report({ file: manifest.file, offset: offsetOf(manifest, "start_url"), message: `Web app manifest start_url ${data.start_url} is outside the scope ${scopePath}, so browsers ignore the scope` });
    }
  },
});

const manifestColors = manifestRule({
  id: "manifest/colors",
  severity: "error",
  description: "A web app manifest's theme_color or background_color is not a valid CSS color.",
  check(manifest, { report }) {
    for (const key of ["theme_color", "background_color"]) {
      const value = manifest.data[key];
      if (value === undefined || isCssColor(value)) continue;
      report({ file: manifest.file, offset: offsetOf(manifest, key), message: `Web app manifest ${key} ${JSON.stringify(value)} is not a CSS color, so browsers ignore it` });
    }
  },
});

const DISPLAY_MODES = ["fullscreen", "standalone", "minimal-ui", "browser"];

const manifestDisplay = manifestRule({
  id: "manifest/display",
  severity: "error",
  description: "A web app manifest's display is not one of fullscreen, standalone, minimal-ui or browser.",
  check(manifest, { report }) {
    const { display } = manifest.data;
    if (display === undefined || (typeof display === "string" && DISPLAY_MODES.includes(display.trim().toLowerCase()))) return;
    report({
      file: manifest.file,
      offset: offsetOf(manifest, "display"),
      message: `Web app manifest display ${JSON.stringify(display)} is not a display mode, so browsers open it in a tab. Use ${DISPLAY_MODES.join(", ")}`,
    });
  },
});

export const manifestRules = [manifestMissing, manifestInvalid, manifestName, manifestIcons, manifestInstallIcons, manifestScope, manifestColors, manifestDisplay];
