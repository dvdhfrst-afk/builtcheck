// The full rule set. Adding a rule means adding it to one of these lists.

import { a11yRules } from "./a11y.js";
import { assetRules } from "./assets.js";
import { copyRules } from "./copy.js";
import { feedRules } from "./feeds.js";
import { foundationRules } from "./foundation.js";
import { i18nRules } from "./i18n.js";
import { linkRules } from "./links.js";
import { manifestRules } from "./manifest.js";
import { metaRules } from "./meta.js";
import { schemaRules } from "./schema.js";
import { styleRules } from "./style.js";

export const allRules = [
  ...foundationRules,
  ...metaRules,
  ...i18nRules,
  ...schemaRules,
  ...linkRules,
  ...a11yRules,
  ...assetRules,
  ...feedRules,
  ...manifestRules,
  ...copyRules,
  ...styleRules,
];
