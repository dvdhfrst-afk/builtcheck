// The full rule set. Adding a rule means adding it to one of these lists.

import { copyRules } from "./copy.js";
import { foundationRules } from "./foundation.js";
import { linkRules } from "./links.js";
import { schemaRules } from "./schema.js";
import { styleRules } from "./style.js";

export const allRules = [...foundationRules, ...schemaRules, ...linkRules, ...copyRules, ...styleRules];
