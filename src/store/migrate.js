// Converts a store of an older format to the current one, keeping every run.
//
// Format 1, a folder of JSON reports, is converted in place. The new store is written into a
// staging folder inside it and moved into place with store.json last, and only then are the
// original reports moved aside into a folder of their own. Until store.json lands the folder
// still reads as a folder of reports, so an interrupted migration loses nothing and can simply be
// run again.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { plainError } from "../cli.js";
import { moveFile, StoreError, withLock } from "./files.js";
import { upgradeResult } from "./result.js";
import { INDEX_FILE, RUNS_FOLDER, Store, STORE_FILE, STORE_VERSION } from "./store.js";

const STAGING = ".migrating";
export const ORIGINALS = "reports-before-migration";

// STEPS[n] converts a store of format n to format n + 1 and describes what it did.
const STEPS = { 1: fromReportFolder };

function guarded(what, action) {
  try {
    return action();
  } catch (error) {
    if (error instanceof StoreError) throw error;
    throw new StoreError(`Cannot ${what}: ${plainError(error)}`);
  }
}

// A name in `folder` that is not taken yet: name, then name-2, name-3 and so on.
function freeName(folder, name) {
  let candidate = name;
  for (let number = 2; existsSync(join(folder, candidate)); number += 1) candidate = `${name}-${number}`;
  return candidate;
}

function fromReportFolder(store) {
  const folder = store.path;
  const staging = join(folder, STAGING);
  // A staging folder left by an interrupted migration is this tool's own, and so are the runs
  // folder and index it may already have moved out of it.
  if (existsSync(staging)) {
    guarded(`clear an earlier, interrupted migration in ${store.shown}`, () => {
      for (const name of [STAGING, RUNS_FOLDER, INDEX_FILE]) rmSync(join(folder, name), { recursive: true, force: true });
    });
  } else if (existsSync(join(folder, RUNS_FOLDER)) || existsSync(join(folder, INDEX_FILE))) {
    throw new StoreError(`${store.shown} already has a ${RUNS_FOLDER} folder or an ${INDEX_FILE} that builtcheck did not write. Move them out of the folder, then migrate again.`);
  }

  const { runs, skipped } = store.legacyRuns();
  const kept = [];
  const left = skipped.map(({ file, reason }) => ({ file, reason }));
  for (const run of runs) {
    try {
      upgradeResult(run.value, run.file);
      kept.push(run);
    } catch (error) {
      if (!(error instanceof StoreError)) throw error;
      left.push({ file: run.file, reason: error.message });
    }
  }

  const target = new Store(staging, staging);
  const added = target.addAll(kept.map((run) => ({
    result: run.value,
    details: { ranAt: run.meta.ranAt, savedAt: run.meta.savedAt, folder: run.meta.folder, source: "report file", file: run.file },
  })));

  // store.json goes last: that is the moment the folder becomes a store of the new format.
  guarded(`move the converted store into ${store.shown}`, () => {
    for (const name of [RUNS_FOLDER, INDEX_FILE, STORE_FILE]) moveFile(join(staging, name), join(folder, name));
  });

  // The originals are no longer read, but they are the user's files: moved aside, never deleted.
  const aside = kept.length > 0 ? freeName(folder, ORIGINALS) : null;
  if (aside) {
    guarded(`move the original reports into ${aside}. The store was converted, and they are no longer read, so they can be moved by hand`, () => {
      mkdirSync(join(folder, aside));
      for (const run of kept) moveFile(join(folder, run.file), join(folder, aside, run.file));
    });
  }
  rmSync(staging, { recursive: true, force: true });
  return {
    from: 1,
    to: 2,
    runs: added.map((entry, index) => ({ id: entry.id, file: kept[index].file })),
    left,
    originals: aside,
  };
}

// Returns { from, to, changed, steps }, one step description per format converted.
export function migrateStore(store) {
  if (store.version === 0) {
    throw new StoreError(store.exists ? `${store.shown} is empty, so there is nothing to convert.` : `There is no results store or folder of reports at ${store.shown}.`);
  }
  const from = store.version;
  const steps = [];
  withLock(store.path, () => {
    store.inspect();
    if (store.version === STORE_VERSION) {
      rmSync(join(store.path, STAGING), { recursive: true, force: true });
      return;
    }
    while (store.version < STORE_VERSION) {
      steps.push(STEPS[store.version](store));
      store.inspect();
    }
  });
  return { from, to: store.version, changed: steps.length > 0, steps };
}
