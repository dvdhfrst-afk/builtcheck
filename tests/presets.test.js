// Config presets and "extends": the built-in presets, chains of config files, and the
// `builtcheck presets` command.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.js";
import { main } from "../src/cli.js";
import { ConfigError, printableConfig, readConfigFile, resolveConfig } from "../src/engine/config.js";
import { PRESET_NAMES, PRESETS } from "../src/engine/presets.js";
import { allRules } from "../src/rules/index.js";
import { TASTE_RULES } from "../src/rules/taste.js";
import { FIXTURES, REPO_ROOT, withFixtureSite } from "./helpers.js";

const BIN = join(REPO_ROOT, "bin", "builtcheck.js");
const BEFORE = join(REPO_ROOT, "examples", "before");

const severities = (config) => Object.fromEntries(Object.entries(config.rules).map(([id, settings]) => [id, settings.severity]));
const resolved = (user, rules = allRules) => severities(resolveConfig(user, rules));
const on = (user, rules = allRules) => Object.entries(resolved(user, rules)).filter(([, severity]) => severity !== "off").map(([id]) => id);
const defaults = Object.fromEntries(allRules.map((rule) => [rule.id, rule.severity]));

// Writes { path: object or text } into a new folder, runs fn(folder), and removes it.
function withFiles(files, fn) {
  const folder = mkdtempSync(join(tmpdir(), "builtcheck-presets-"));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const full = join(folder, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents));
    }
    return fn(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function rejects(fn, pattern) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof ConfigError, `${error.constructor.name}: ${error.message}`);
    assert.match(error.message, pattern);
    return true;
  });
}

function cli(args, cwd = REPO_ROOT) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

// A rule set with groups the real one has no rules in yet, as other groups fill up.
const fakeRule = (id, severity = "warning") => ({ id, severity, description: "A rule for this test.", options: {} });

// ---- The built-in presets

test("every built-in preset is named builtcheck:, described, and made of ids and groups that exist", () => {
  const ids = new Set(allRules.map((rule) => rule.id));
  assert.deepEqual(PRESET_NAMES, ["builtcheck:recommended", "builtcheck:strict", "builtcheck:seo", "builtcheck:accessibility", "builtcheck:minimal"]);
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.ok(name.startsWith("builtcheck:"));
    assert.ok(preset.description.length > 20, name);
    for (const pattern of [...(preset.reset ?? []), ...(preset.only ?? []), ...(preset.keep ?? [])]) {
      if (pattern === "*") continue;
      if (pattern.endsWith("/*")) {
        // A group may have no rules yet, but it must be a group: one of the rule modules.
        const group = pattern.slice(0, -2);
        assert.ok(existsSync(join(REPO_ROOT, "src", "rules", `${group}.js`)), `${name}: no rule group ${group}`);
      } else {
        assert.ok(ids.has(pattern), `${name}: no rule ${pattern}`);
      }
    }
    assert.doesNotThrow(() => resolveConfig({ extends: name }, allRules), name);
  }
});

test("builtcheck:recommended is the defaults, and undoes what came before it", () => {
  assert.deepEqual(resolved({ extends: "builtcheck:recommended" }), defaults);
  assert.deepEqual(resolveConfig({ extends: "builtcheck:recommended" }, allRules), resolveConfig({}, allRules));
  assert.deepEqual(resolved({ extends: ["builtcheck:minimal", "builtcheck:recommended"] }), defaults);
});

test("builtcheck:strict makes every warning an error except the four style preference rules", () => {
  const strict = resolved({ extends: "builtcheck:strict" });
  assert.equal(TASTE_RULES.length, 4);
  for (const rule of allRules) {
    const expected = TASTE_RULES.includes(rule.id) ? rule.severity : "error";
    assert.equal(strict[rule.id], expected, rule.id);
  }
  // A rule an earlier entry turned off stays off, and one made an error stays an error.
  assert.equal(resolved({ extends: ["builtcheck:minimal", "builtcheck:strict"] })["copy/em-dash"], "off");
  withFiles({ "taste.json": { rules: { "copy/em-dash": "error" } } }, (folder) => {
    assert.equal(resolved({ extends: [join(folder, "taste.json"), "builtcheck:strict"] })["copy/em-dash"], "error");
  });
});

test("builtcheck:seo keeps only the foundation, meta, i18n, schema and links groups", () => {
  const seo = resolved({ extends: "builtcheck:seo" });
  for (const rule of allRules) {
    const kept = /^(foundation|meta|i18n|schema|links)\//.test(rule.id);
    assert.equal(seo[rule.id], kept ? rule.severity : "off", rule.id);
  }
});

test("presets tolerate groups that are empty today, and rules added to a group later join them", () => {
  const today = [fakeRule("links/a", "error"), fakeRule("copy/b")];
  assert.deepEqual(on({ extends: "builtcheck:seo" }, today), ["links/a"]);
  assert.deepEqual(on({ extends: "builtcheck:accessibility" }, today), ["links/a"]);
  const later = [...today, fakeRule("meta/title"), fakeRule("i18n/lang"), fakeRule("a11y/alt-text", "error"), fakeRule("feeds/rss")];
  assert.deepEqual(on({ extends: "builtcheck:seo" }, later), ["links/a", "meta/title", "i18n/lang"]);
  assert.deepEqual(on({ extends: "builtcheck:accessibility" }, later), ["links/a", "a11y/alt-text"]);
  assert.deepEqual(resolved({ extends: "builtcheck:strict" }, later), { "links/a": "error", "copy/b": "error", "meta/title": "error", "i18n/lang": "error", "a11y/alt-text": "error", "feeds/rss": "error" });
  // A preset naming rules this rule set lacks does not fail; it keeps none of them.
  assert.deepEqual(on({ extends: "builtcheck:minimal" }, later), []);
});

test("builtcheck:accessibility keeps a11y and links, and builtcheck:minimal only broken links and missing files", () => {
  assert.deepEqual(on({ extends: "builtcheck:accessibility" }), allRules.filter((rule) => /^(a11y|links)\//.test(rule.id)).map((rule) => rule.id));
  assert.deepEqual(on({ extends: "builtcheck:minimal" }).sort(), [
    "foundation/llms-txt-missing",
    "foundation/robots-missing",
    "foundation/sitemap-missing",
    "foundation/social-image-missing",
    "links/broken-asset",
    "links/broken-internal",
    "links/missing-anchor",
  ]);
});

test("presets combine in order: seo then strict is the seo rules, made strict", () => {
  const both = resolved({ extends: ["builtcheck:seo", "builtcheck:strict"] });
  for (const rule of allRules) {
    const kept = /^(foundation|meta|i18n|schema|links)\//.test(rule.id);
    assert.equal(both[rule.id], kept ? "error" : "off", rule.id);
  }
  assert.deepEqual(resolved({ extends: ["builtcheck:strict", "builtcheck:seo"] }), both);
});

test("the config's own settings win over everything it extends, groups and exact entries alike", () => {
  const config = { extends: ["builtcheck:minimal", "builtcheck:strict"], rules: { "copy/*": "warning", "links/broken-asset": "off", "schema/required-field": { required: { Event: ["name"] } } } };
  const result = resolveConfig(config, allRules);
  assert.equal(result.rules["copy/em-dash"].severity, "warning");
  assert.equal(result.rules["copy/placeholder-text"].severity, "warning");
  assert.equal(result.rules["links/broken-asset"].severity, "off");
  assert.equal(result.rules["links/broken-internal"].severity, "error");
  // Setting options asks for the rule, at its default severity, as without extends.
  assert.equal(result.rules["schema/required-field"].severity, "error");
  assert.deepEqual(result.rules["schema/required-field"].options.required.Event, ["name"]);
  assert.equal(result.rules["style/phone-overflow"].severity, "off");
});

test("a mistyped preset name says so and suggests the right one", () => {
  rejects(() => resolveConfig({ extends: "builtcheck:strickt" }, allRules), /"builtcheck:strickt" is not a built-in preset\. Did you mean "builtcheck:strict"\? Presets: builtcheck:recommended/);
  rejects(() => resolveConfig({ extends: ["builtcheck:seo", 5] }, allRules), /"extends" must be a preset name or a config file path/);
  rejects(() => resolveConfig({ extends: "" }, allRules), /"extends" must be/);
  rejects(() => resolveConfig({ extends: { name: "x" } }, allRules), /"extends" must be/);
  rejects(() => resolveConfig({ extend: "builtcheck:seo" }, allRules), /"extend" is not a config setting\. Known settings: extends, site, ignore, rules, store/);
});

// ---- Config files that extend other files

test("a file path in extends is relative to the file that names it, through a chain of folders", () => {
  withFiles(
    {
      "project/builtcheck.config.json": { extends: "../shared/team.json", rules: { "copy/em-dash": "error" } },
      "shared/team.json": { extends: ["builtcheck:seo", "./base/base.json"], ignore: ["drafts/**"], site: { url: "https://www.example.com" } },
      "shared/base/base.json": { ignore: ["vendor/**", "drafts/**"], site: { url: "https://old.example.org", externalPaths: ["/api/**"] }, rules: { "links/placeholder-href": "off", "copy/em-dash": "off" } },
    },
    (folder) => {
      const config = resolveConfig(readConfigFile(join(folder, "project", "builtcheck.config.json")), allRules);
      // Later entries win key by key; ignore patterns add up, once each.
      assert.equal(config.site.url, "https://www.example.com");
      assert.deepEqual(config.site.externalPaths, ["/api/**"]);
      assert.deepEqual(config.ignore, ["vendor/**", "drafts/**"]);
      assert.equal(config.rules["links/placeholder-href"].severity, "off");
      // seo turned copy off, and the project's own file turned em-dash back on.
      assert.equal(config.rules["copy/em-dash"].severity, "error");
      assert.equal(config.rules["copy/placeholder-text"].severity, "off");
      assert.equal(config.rules["schema/page-missing"].severity, "warning");
    },
  );
});

test("an extended file's group entry does not beat the extending file's exact entry, or the other way round", () => {
  withFiles(
    {
      "base.json": { rules: { "copy/em-dash": "off", "style/*": "off" } },
      "config.json": { extends: "./base.json", rules: { "copy/*": "error", "style/banned-font": "error" } },
    },
    (folder) => {
      const config = resolved(readConfigFile(join(folder, "config.json")));
      assert.equal(config["copy/em-dash"], "error");
      assert.equal(config["style/banned-font"], "error");
      assert.equal(config["style/pure-color"], "off");
    },
  );
});

test("a loop in extends is a plain config error naming the chain", () => {
  withFiles(
    {
      "a.json": { extends: "./b.json" },
      "b.json": { extends: ["builtcheck:seo", "./c.json"] },
      "c.json": { extends: "./a.json" },
      "self.json": { extends: "./self.json" },
    },
    (folder) => {
      // The file run with is known only by its contents, so the loop shows from the first file it extends.
      rejects(() => resolveConfig(readConfigFile(join(folder, "a.json")), allRules), /^extends \S*b\.json -> \S*c\.json -> \S*a\.json -> \S*b\.json: the chain comes back to a file it already passed through$/);
      rejects(() => resolveConfig(readConfigFile(join(folder, "self.json")), allRules), /^extends .*self\.json: the chain comes back/);
    },
  );
});

test("the same file reached twice by different routes is not a loop", () => {
  withFiles(
    {
      "shared.json": { rules: { "copy/em-dash": "off" } },
      "left.json": { extends: "./shared.json" },
      "right.json": { extends: "./shared.json" },
      "config.json": { extends: ["./left.json", "./right.json"] },
    },
    (folder) => assert.equal(resolved(readConfigFile(join(folder, "config.json")))["copy/em-dash"], "off"),
  );
});

test("a missing or broken extended file is a config error naming the chain", () => {
  withFiles(
    {
      "config.json": { extends: "./team.json" },
      "team.json": { extends: "./missing.json" },
      "bad.json": { extends: "./not-json.json" },
      "not-json.json": "{ nope",
      "wrong.json": { extends: "./wrong-rule.json" },
      "wrong-rule.json": { rules: { "copy/em-dashes": "off" } },
      "regex.json": { extends: "./bad-regex.json" },
      "bad-regex.json": { rules: { "copy/placeholder-text": { extraPatterns: ["("] } } },
      "store.json": { extends: "./with-store.json" },
      "with-store.json": { store: { save: true } },
    },
    (folder) => {
      const read = (name) => resolveConfig(readConfigFile(join(folder, name)), allRules);
      rejects(() => read("config.json"), /^Cannot read config file .*missing\.json: no such file \(extends .*team\.json -> .*missing\.json\)$/);
      rejects(() => read("bad.json"), /^Config file .*not-json\.json is not valid JSON: .* \(extends .*not-json\.json\)$/);
      rejects(() => read("wrong.json"), /^extends .*wrong-rule\.json: rules\."copy\/em-dashes" is not a rule\. Did you mean "copy\/em-dash"\?$/);
      rejects(() => read("regex.json"), /^extends .*bad-regex\.json: rules\."copy\/placeholder-text": .*regular expression/);
      rejects(() => read("store.json"), /^extends .*with-store\.json: "store" can only be set in the config file builtcheck runs with/);
    },
  );
});

test("a config built in code extends files relative to the current folder, and presets by name", () => {
  withFixtureSite("clean-site", (root) => {
    const minimal = audit(root, { extends: "builtcheck:minimal" });
    assert.equal(minimal.summary.errors, 0);
    const before = audit(BEFORE, { extends: "builtcheck:minimal" });
    assert.deepEqual([...new Set(before.findings.map((finding) => finding.rule))].sort(), ["foundation/llms-txt-missing", "links/broken-asset", "links/broken-internal", "links/missing-anchor"]);
  });
  rejects(() => resolveConfig({ extends: "./surely-not-here.json" }, allRules), /Cannot read config file surely-not-here\.json: no such file/);
});

test("reading a file leaves paths it extends absolute, so a copy of the object still finds them", () => {
  withFiles({ "sub/config.json": { extends: ["builtcheck:seo", "../base.json"] }, "base.json": { rules: { "copy/em-dash": "off" } } }, (folder) => {
    const config = readConfigFile(join(folder, "sub", "config.json"));
    assert.deepEqual(config.extends, ["builtcheck:seo", join(folder, "base.json")]);
    const copied = { ...config, site: { url: "https://www.example.com" } };
    assert.equal(resolveConfig(copied, allRules).site.url, "https://www.example.com");
  });
});

// ---- The resolved config, printed

test("the printed config is the full resolved config, with nothing left to extend, and reads back the same", () => {
  for (const name of PRESET_NAMES) {
    const printed = printableConfig({ extends: name, ignore: ["drafts/**"] }, allRules);
    assert.equal(printed.extends, undefined);
    assert.deepEqual(Object.keys(printed.rules), allRules.map((rule) => rule.id));
    assert.deepEqual(printed.ignore, ["drafts/**"]);
    assert.deepEqual(resolveConfig(printed, allRules).rules, resolveConfig({ extends: name, ignore: ["drafts/**"] }, allRules).rules, name);
  }
  assert.deepEqual(printableConfig({ store: { save: true } }, allRules).store, { save: true });
  assert.equal(printableConfig({}, allRules).store, undefined);
  assert.deepEqual(printableConfig({}, allRules).rules["style/banned-font"].fonts.length, 4);
});

// ---- The command line

test("a config file with extends works end to end, and --site-url still applies over it", () => {
  withFiles(
    {
      "configs/builtcheck.config.json": { extends: ["builtcheck:minimal", "./team.json"] },
      "configs/team.json": { rules: { "foundation/llms-txt-missing": "off" }, site: { url: "https://www.example.org" } },
    },
    (folder) => {
      const config = join(folder, "configs", "builtcheck.config.json");
      const { code, out, err } = cli([BEFORE, "--config", config, "--format", "json"]);
      assert.equal(code, 1, err);
      const report = JSON.parse(out);
      assert.deepEqual([...new Set(report.findings.map((finding) => finding.rule))].sort(), ["links/broken-asset", "links/broken-internal", "links/missing-anchor"]);
      // The host is reported without "www.".
      assert.equal(report.site.host, "example.org");
      const overridden = JSON.parse(cli([BEFORE, "--config", config, "--format", "json", "--site-url", "https://www.example.com"]).out);
      assert.equal(overridden.site.host, "example.com");
      assert.deepEqual(overridden.findings.map((finding) => finding.rule).sort(), report.findings.map((finding) => finding.rule).sort());
    },
  );
});

test("the default config file in the current folder can extend a preset", () => {
  withFiles({ "builtcheck.config.json": { extends: "builtcheck:minimal", rules: { "foundation/llms-txt-missing": "off", "links/*": "off" } } }, (folder) => {
    const { code, out } = cli([BEFORE], folder);
    assert.equal(code, 0, out);
    assert.match(out, /No problems found/);
  });
});

test("a bad extends chain stops the command line with exit code 2 and a plain message", () => {
  withFiles({ "a.json": { extends: "./b.json" }, "b.json": { extends: "./a.json" }, "c.json": { extends: "builtcheck:nope" } }, (folder) => {
    const loop = cli([BEFORE, "--config", join(folder, "a.json")]);
    assert.equal(loop.code, 2);
    assert.match(loop.err, /^builtcheck: extends \S*b\.json -> \S*a\.json -> \S*b\.json: the chain comes back to a file it already passed through\n$/);
    assert.ok(!loop.err.includes("bug in builtcheck"));
    const unknown = cli([BEFORE, "--config", join(folder, "c.json")]);
    assert.equal(unknown.code, 2);
    assert.match(unknown.err, /"builtcheck:nope" is not a built-in preset/);
  });
});

test("builtcheck presets lists every preset with its description and how many rules it turns on", () => {
  const { code, out } = cli(["presets"]);
  assert.equal(code, 0);
  for (const name of PRESET_NAMES) {
    const count = on({ extends: name }).length;
    assert.ok(out.includes(`${name}  (${count} of ${allRules.length} rules on, `), name);
    assert.ok(out.includes(PRESETS[name].description), name);
  }
  assert.ok(cli(["--help"]).out.includes("builtcheck presets"));
});

test("builtcheck presets <name> prints that preset resolved, with or without its prefix", () => {
  const full = cli(["presets", "builtcheck:strict"]);
  assert.equal(full.code, 0);
  const printed = JSON.parse(full.out);
  assert.deepEqual(printed, printableConfig({ extends: "builtcheck:strict" }, allRules));
  assert.equal(printed.rules["schema/page-missing"].severity, "error");
  assert.equal(cli(["presets", "strict"]).out, full.out);
  // What it prints works as a config file.
  withFiles({ "strict.json": full.out }, (folder) => {
    assert.deepEqual(resolved(readConfigFile(join(folder, "strict.json"))), resolved({ extends: "builtcheck:strict" }));
  });
});

test("builtcheck presets rejects an unknown name, extra words and options, and has its own help", () => {
  const unknown = cli(["presets", "strickt"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /^builtcheck: "strickt" is not a built-in preset\. Presets: builtcheck:recommended/);
  assert.equal(cli(["presets", "seo", "strict"]).code, 2);
  assert.match(cli(["presets", "--json"]).err, /Unknown option for presets: --json/);
  const help = cli(["presets", "--help"]);
  assert.equal(help.code, 0);
  assert.match(help.out, /builtcheck presets <name>/);
});

test("the presets command runs in process through main as well", () => {
  let out = "";
  const code = main(["presets", "minimal"], { stdout: (text) => { out += text; }, stderr: () => {}, isTty: false });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).rules["copy/em-dash"].severity, "off");
});

// ---- Documentation

test("docs/configuration.md names every setting, every preset and the store settings", () => {
  const docs = readFileSync(join(REPO_ROOT, "docs", "configuration.md"), "utf8");
  for (const setting of ["extends", "site", "ignore", "rules", "store"]) assert.ok(docs.includes(`\`${setting}\``), setting);
  for (const name of PRESET_NAMES) assert.ok(docs.includes(`\`${name}\``), name);
  for (const key of ["url", "basePath", "externalPaths", "sitemapPaths", "socialImagePaths", "path", "save"]) assert.ok(docs.includes(`\`${key}\``), key);
  // Each JSON example on the page is a config that resolves.
  const examples = [...docs.matchAll(/^```json\n([^]*?)^```$/gm)].map((match) => JSON.parse(match[1]));
  assert.ok(examples.length >= 3);
  for (const example of examples) {
    const files = Array.isArray(example.extends) ? example.extends : example.extends ? [example.extends] : [];
    if (files.some((entry) => !entry.startsWith("builtcheck:"))) continue;
    assert.doesNotThrow(() => resolveConfig(example, allRules), JSON.stringify(example));
  }
});

test("the bad-pages fixture audits the same through a preset chain as through its own file", () => {
  const config = readConfigFile(join(FIXTURES, "bad-pages", "config.json"));
  withFixtureSite("bad-pages", (root) => {
    const direct = audit(root, config);
    const viaRecommended = audit(root, { ...config, extends: "builtcheck:recommended" });
    assert.deepEqual(viaRecommended.findings, direct.findings);
    const strict = audit(root, { ...config, extends: "builtcheck:strict" });
    assert.equal(strict.findings.length, direct.findings.length);
    assert.ok(strict.findings.every((finding) => finding.severity === "error" || TASTE_RULES.includes(finding.rule)));
    assert.ok(strict.summary.errors > direct.summary.errors);
  });
  // A page that is fine stays fine under every preset.
  withFixtureSite("clean-site", (root) => {
    for (const name of PRESET_NAMES) assert.equal(audit(root, { extends: name }).summary.errors, 0, name);
  });
});
