// The built-in presets a config can start from with "extends". Each one is a set of changes laid
// over whatever came before it, written as group patterns and rule ids. A rule added to a group
// later joins every preset that names the group, and a group with no rules yet is simply empty.

import { TASTE_RULES } from "../rules/taste.js";
import { ruleMatches } from "./suppressions.js";

export const PRESET_PREFIX = "builtcheck:";

// Each preset may hold:
//   reset    patterns whose rules go back to their default severity and options
//   only     patterns to keep: every other rule is turned off
//   promote  true to make every warning an error, apart from the rule ids in `keep`
export const PRESETS = {
  "builtcheck:recommended": {
    description: "Every rule at its default severity and options. The same as extending nothing, and a way to undo an entry before it.",
    reset: ["*"],
  },
  "builtcheck:strict": {
    description: "Every warning becomes an error, except the style preference rules, which stay as they are.",
    promote: true,
    keep: TASTE_RULES,
  },
  "builtcheck:seo": {
    description: "Only what search engines and AI crawlers read: foundation files, page metadata, languages, structured data and links.",
    only: ["foundation/*", "meta/*", "i18n/*", "schema/*", "links/*"],
  },
  "builtcheck:accessibility": {
    description: "Only accessibility and links.",
    only: ["a11y/*", "links/*"],
  },
  "builtcheck:minimal": {
    description: "Only broken links and missing foundation files: robots.txt, a sitemap, llms.txt and the default social image.",
    only: [
      "links/broken-internal",
      "links/missing-anchor",
      "links/broken-asset",
      "foundation/robots-missing",
      "foundation/sitemap-missing",
      "foundation/llms-txt-missing",
      "foundation/social-image-missing",
    ],
  },
};

export const PRESET_NAMES = Object.keys(PRESETS);

// Changes `resolved` ({ [id]: { severity, options } }) in place. A rule a preset keeps stays as an
// earlier entry left it, so presets combine: seo then strict is the seo rules, made strict.
export function applyPreset(preset, resolved, rules) {
  for (const rule of rules) {
    const settings = resolved[rule.id];
    if (preset.reset && ruleMatches(preset.reset, rule.id)) {
      settings.severity = rule.severity;
      settings.options = structuredClone(rule.options ?? {});
    }
    if (preset.only && !ruleMatches(preset.only, rule.id)) settings.severity = "off";
    if (preset.promote && settings.severity === "warning" && !preset.keep.includes(rule.id)) settings.severity = "error";
  }
}
