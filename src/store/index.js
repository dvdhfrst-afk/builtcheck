// The results store: where saved runs live. Saving is asked for with --save or "store.save" in
// the config file.

export class StoreError extends Error {}

export const DEFAULT_STORE = { path: ".builtcheck", save: false };

// Saves one result and returns a description of the saved run.
export function saveRun() {
  throw new StoreError("saving runs is not available in this build");
}
