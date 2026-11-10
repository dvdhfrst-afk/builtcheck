// The results store: a folder holding the history of saved runs, so a site owner can look back at
// any audit and see what changed between two. Saving is asked for with --save or "store.save" in
// the config file, and the store commands in src/commands/ read it. See docs/store.md.

import { resolve } from "node:path";
import { isSameOrInside, reachedPath } from "../cli.js";
import { resolveConfig } from "../engine/config.js";
import { allRules } from "../rules/index.js";
import { StoreError } from "./files.js";
import { gitState } from "./git.js";
import { digestOf, Store } from "./store.js";

export { StoreError } from "./files.js";
export { compareResults } from "./compare.js";
export { migrateStore } from "./migrate.js";
export { upgradeResult } from "./result.js";
export { Store, STORE_VERSION } from "./store.js";

export const DEFAULT_STORE = { path: ".builtcheck", save: false };

const LABEL_LIMIT = 80;

export function openStore(path = DEFAULT_STORE.path, { cwd = process.cwd() } = {}) {
  return new Store(resolve(cwd, path), path);
}

// A label names a run for people, so it is one short line of text.
export function checkLabel(label) {
  if (label === undefined || label === null) return null;
  const text = String(label).trim();
  if (text === "" || text.length > LABEL_LIMIT || /[\u0000-\u001f\u007f-\u009f]/.test(text)) {
    throw new StoreError(`A label must be one line of 1 to ${LABEL_LIMIT} characters, such as release-2.4`);
  }
  return text;
}

// The settings the audit ran with, after defaults, --only and --skip, as one digest: two runs
// with the same digest checked the same rules in the same way.
export function configDigest(config = {}, selection = {}) {
  return digestOf(resolveConfig(config ?? {}, allRules, selection));
}

// Opens the store a run will be saved in and checks it can be, before the audit starts, so a
// long audit is not wasted on a store that would refuse the result. The config is checked first,
// since the store settings come from it.
export function checkSaveTarget({ root, store: settings = {}, config = {}, selection = {}, label = null, cwd = process.cwd() }) {
  resolveConfig(config, allRules, selection);
  checkLabel(label);
  const shown = settings.path ?? DEFAULT_STORE.path;
  const path = resolve(cwd, shown);
  if (root && (isSameOrInside(resolve(root), path) || isSameOrInside(reachedPath(resolve(root)), reachedPath(path)))) {
    throw new StoreError(`The results store ${shown} is inside the site folder, so it would be audited, and deployed, as part of the site. Keep it outside with --store or "store.path" in the config file.`);
  }
  const store = openStore(shown, { cwd });
  store.requireWritable();
  return store;
}

// Saves one result and returns { id, store, entry }: the new run's id, the store folder as given,
// and the run's index entry.
export function saveRun(result, { root, folder, store: settings = {}, config = {}, selection = {}, label = null, cwd = process.cwd(), now = Date.now() } = {}) {
  const store = checkSaveTarget({ root, store: settings, config, selection, label, cwd });
  const entry = store.add(result, {
    ranAt: new Date(now).toISOString(),
    label: checkLabel(label),
    folder: folder ?? result.root ?? null,
    configDigest: configDigest(config, selection),
    git: gitState(cwd),
    source: "audit",
  });
  return { id: entry.id, store: store.shown, entry };
}
