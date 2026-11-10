// One results store on disk. The layout is a stable contract, described in docs/store.md:
//
//   store.json       { format, storeVersion, created, createdBy }: marks the folder as a store
//   index.json       { storeVersion, runs: [entry, ...] }, oldest first, rebuilt from runs/ at will
//   runs/<id>.json   { storeVersion, meta, result }: one file per run, holding the full result
//   lock             there only while a run is being saved
//
// Store format 1 is what came before it: a plain folder of JSON reports written with
// --format json --output. It is read as it is, and migrate.js converts it.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { version as toolVersion } from "../audit.js";
import { plainError } from "../cli.js";
import { LOCK_FILE, readJson, StoreError, withLock, writeJson } from "./files.js";
import { looksLikeResult, upgradeResult } from "./result.js";

export const STORE_VERSION = 2;
export const STORE_FORMAT = "builtcheck results store";
export const STORE_FILE = "store.json";
export const INDEX_FILE = "index.json";
export const RUNS_FOLDER = "runs";

const ID = /^\d{8}-\d{6}-\d{3}$/;
const RUN_FILE = /^(\d{8}-\d{6}-\d{3})\.json$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// JSON with object keys sorted, so equal values give equal text whatever order they were built in.
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function digestOf(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

// A run's id is the UTC time it ran, to the millisecond, as 20261109-142530-123.
export function idFor(time) {
  const date = new Date(time);
  const two = (number) => String(number).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}-` +
    `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}-${String(date.getUTCMilliseconds()).padStart(3, "0")}`
  );
}

// Moves on a millisecond while an id is taken, so ids stay unique and still sort by time.
export function freeId(time, taken) {
  let moment = Math.floor(time);
  while (taken.has(idFor(moment))) moment += 1;
  return idFor(moment);
}

// The summary of one run that history needs, kept in the index so listing reads no run files.
export function entryFor(meta, result) {
  return {
    id: meta.id,
    ranAt: meta.ranAt,
    savedAt: meta.savedAt,
    label: meta.label,
    folder: meta.folder,
    toolVersion: meta.toolVersion,
    source: meta.source,
    errors: result.summary.errors,
    warnings: result.summary.warnings,
    pages: result.summary.pages,
    complete: result.complete,
    configDigest: meta.configDigest,
    resultDigest: meta.resultDigest,
    git: meta.git,
  };
}

function isEntry(value) {
  return (
    isObject(value) && typeof value.id === "string" && ID.test(value.id) && typeof value.ranAt === "string" &&
    ["errors", "warnings", "pages"].every((key) => Number.isInteger(value[key])) && typeof value.complete === "boolean"
  );
}

const META_DEFAULTS = { label: null, folder: null, toolVersion: null, configDigest: null, resultDigest: null, git: null, source: "audit" };

function checkedMeta(meta, id, where) {
  if (!isObject(meta) || meta.id !== id || typeof meta.ranAt !== "string") {
    throw new StoreError(`${where} is damaged: its metadata is missing or names another run.`);
  }
  return { ...META_DEFAULTS, savedAt: meta.ranAt, ...meta };
}

// The metadata of a new run. `details` holds what the caller knows: ranAt, label, folder,
// configDigest, git, source and, for an imported report, its file name.
export function metaFor(id, result, details) {
  return {
    id,
    ranAt: details.ranAt,
    savedAt: details.savedAt ?? new Date().toISOString(),
    label: details.label ?? null,
    folder: details.folder ?? null,
    toolVersion: typeof result.version === "string" ? result.version : null,
    configDigest: details.configDigest ?? null,
    resultDigest: digestOf(result),
    git: details.git ?? null,
    source: details.source ?? "audit",
    ...(details.file ? { file: details.file } : {}),
  };
}

export class Store {
  // `path` is absolute; `shown` is the folder as the user gave it, for messages.
  constructor(path, shown = path) {
    this.path = path;
    this.shown = shown;
    this.unreadable = [];
    this.inspect();
  }

  // Sets version: 0 when there is no store yet, 1 for a folder of JSON reports, or the store
  // format recorded in store.json.
  inspect() {
    this.version = 0;
    this.exists = false;
    this.legacy = null;
    let stat;
    try {
      stat = statSync(this.path);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw new StoreError(`Cannot read the results store at ${this.shown}: ${plainError(error)}`);
    }
    if (!stat.isDirectory()) throw new StoreError(`The results store ${this.shown} is a file, not a folder.`);
    this.exists = true;
    const names = this.namesIn(this.path);
    if (names.includes(STORE_FILE)) {
      const marker = readJson(join(this.path, STORE_FILE), `The results store at ${this.shown}`);
      if (!isObject(marker) || marker.format !== STORE_FORMAT || !Number.isInteger(marker.storeVersion) || marker.storeVersion < 2) {
        throw new StoreError(`The results store at ${this.shown} is damaged: its ${STORE_FILE} does not describe a builtcheck store.`);
      }
      if (marker.storeVersion > STORE_VERSION) {
        throw new StoreError(`The results store at ${this.shown} is in store format ${marker.storeVersion}, from a newer builtcheck. This version reads format ${STORE_VERSION} and older, so update builtcheck to use it.`);
      }
      this.version = marker.storeVersion;
      return;
    }
    // The lock and dot-named temporary files appear while a store is being created.
    const others = names.filter((name) => name !== LOCK_FILE && !name.startsWith("."));
    if (others.length === 0) return;
    if (this.legacyRuns().runs.length > 0) {
      this.version = 1;
      return;
    }
    throw new StoreError(`${this.shown} is not a results store: it has no ${STORE_FILE} and holds no builtcheck JSON reports. Choose another folder with --store.`);
  }

  namesIn(folder) {
    try {
      return readdirSync(folder);
    } catch (error) {
      throw new StoreError(`Cannot read the results store at ${this.shown}: ${plainError(error)}`);
    }
  }

  // Store format 1: each JSON report at the top of the folder is a run. A report file does not
  // say when it ran, so the time it was written stands in, and gives the run its id.
  legacyRuns() {
    if (this.legacy) return this.legacy;
    const found = [];
    const skipped = [];
    for (const name of this.namesIn(this.path).filter((entry) => /\.json$/i.test(entry) && !entry.startsWith(".")).sort()) {
      const path = join(this.path, name);
      try {
        const stat = statSync(path);
        if (!stat.isFile()) continue;
        const value = readJson(path, name);
        if (looksLikeResult(value)) found.push({ name, time: stat.mtimeMs, value });
        else skipped.push({ file: name, reason: "not a builtcheck JSON report", damaged: false });
      } catch (error) {
        const reason = error.damaged ? "not valid JSON" : error instanceof StoreError ? error.message : `cannot be read: ${plainError(error)}`;
        skipped.push({ file: name, reason, damaged: true });
      }
    }
    found.sort((a, b) => a.time - b.time || (a.name < b.name ? -1 : 1));
    const taken = new Set();
    const runs = found.map(({ name, time, value }) => {
      const id = freeId(time, taken);
      taken.add(id);
      const ranAt = new Date(time).toISOString();
      const meta = metaFor(id, value, { ranAt, savedAt: ranAt, folder: typeof value.root === "string" ? value.root : null, source: "report file", file: name });
      return { id, file: name, value, meta };
    });
    this.legacy = { runs, skipped };
    return this.legacy;
  }

  runFile(id) {
    return join(this.path, RUNS_FOLDER, `${id}.json`);
  }

  // Every run id, oldest first, including runs whose file turns out to be damaged.
  runIds() {
    if (this.version === 0) return [];
    if (this.version === 1) return this.legacyRuns().runs.map((run) => run.id);
    let names;
    try {
      names = readdirSync(join(this.path, RUNS_FOLDER));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw new StoreError(`Cannot read the runs in ${this.shown}: ${plainError(error)}`);
    }
    return names.map((name) => RUN_FILE.exec(name)?.[1]).filter(Boolean).sort();
  }

  // The index's entries, or null when it is missing or damaged.
  readIndex() {
    try {
      const index = readJson(join(this.path, INDEX_FILE), "The index");
      return isObject(index) && Array.isArray(index.runs) ? index.runs.filter(isEntry) : null;
    } catch (error) {
      if (error instanceof StoreError) return null;
      throw error;
    }
  }

  // Every readable run's entry, oldest first. The index gives each summary without reading the
  // run's file. A run the index lacks, as when a save was killed between writing the run and the
  // index, is read from its file, and an entry whose file is gone is left out. Runs that cannot
  // be read are listed in this.unreadable.
  entries() {
    this.unreadable = [];
    const indexed = new Map((this.version >= 2 ? (this.readIndex() ?? []) : []).map((entry) => [entry.id, entry]));
    const entries = [];
    for (const id of this.runIds()) {
      if (indexed.has(id)) {
        entries.push(indexed.get(id));
        continue;
      }
      try {
        const { meta, result } = this.load(id);
        entries.push(entryFor(meta, result));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        this.unreadable.push({ id, reason: error.message });
      }
    }
    return entries;
  }

  // One run's metadata and its result, upgraded to the current result version.
  load(id) {
    const where = `Run ${id}`;
    if (this.version === 1) {
      const run = this.legacyRuns().runs.find((candidate) => candidate.id === id);
      if (!run) throw new StoreError(`There is no run ${id} in ${this.shown}.`);
      return { meta: run.meta, result: upgradeResult(run.value, `${where} (${run.file})`) };
    }
    const record = readJson(this.runFile(id), `${where} (${RUNS_FOLDER}/${id}.json)`);
    if (!isObject(record) || !Number.isInteger(record.storeVersion)) {
      throw new StoreError(`${where} is damaged: ${RUNS_FOLDER}/${id}.json is not a saved run.`);
    }
    if (record.storeVersion > STORE_VERSION) {
      throw new StoreError(`${where} was saved by a newer builtcheck (store format ${record.storeVersion}), so update builtcheck to read it.`);
    }
    return { meta: checkedMeta(record.meta, id, where), result: upgradeResult(record.result, where) };
  }

  // Turns latest, latest~N, an id or the start of one into a run id.
  resolve(reference) {
    const ids = this.runIds();
    if (ids.length === 0) throw new StoreError(`There are no runs in ${this.shown} yet. Save one with: builtcheck <folder> --save`);
    const back = /^latest(?:~(\d+))?$/.exec(reference);
    if (back) {
      const steps = Number(back[1] ?? 0);
      if (steps >= ids.length) {
        throw new StoreError(`${reference} does not exist: ${this.shown} holds ${ids.length === 1 ? "1 run" : `${ids.length} runs`}, so the oldest is latest~${ids.length - 1}.`);
      }
      return ids[ids.length - 1 - steps];
    }
    if (ids.includes(reference)) return reference;
    const matches = reference === "" ? [] : ids.filter((id) => id.startsWith(reference));
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) throw new StoreError(`No run in ${this.shown} has an id starting "${reference}". builtcheck history lists the ids.`);
    const shown = matches.slice(0, 3).join(", ");
    throw new StoreError(`"${reference}" is the start of ${matches.length} run ids (${shown}${matches.length > 3 ? ", ..." : ""}). Give more of the id.`);
  }

  // Reading works in any format this version knows; writing needs the current one.
  requireWritable() {
    if (this.version === 1) {
      throw new StoreError(`The results store at ${this.shown} is a folder of JSON reports, the layout from before the store had a format. Convert it first, keeping every report, with: builtcheck store migrate ${this.shown}`);
    }
    if (this.version !== 0 && this.version < STORE_VERSION) {
      throw new StoreError(`The results store at ${this.shown} is in store format ${this.version}, older than the format ${STORE_VERSION} this version writes. Convert it first with: builtcheck store migrate ${this.shown}`);
    }
  }

  // Runs `fn` holding the lock, after checking the format again under it, and creates the store
  // if there is none yet.
  writing(fn) {
    this.requireWritable();
    try {
      mkdirSync(this.path, { recursive: true });
    } catch (error) {
      throw new StoreError(`Cannot create the results store at ${this.shown}: ${plainError(error)}`);
    }
    return withLock(this.path, () => {
      this.inspect();
      this.requireWritable();
      // store.json first: a folder holding only a runs folder would not read as a store.
      if (this.version === 0) {
        writeJson(join(this.path, STORE_FILE), { format: STORE_FORMAT, storeVersion: STORE_VERSION, created: new Date().toISOString(), createdBy: `builtcheck ${toolVersion}` });
        this.version = STORE_VERSION;
      }
      try {
        mkdirSync(join(this.path, RUNS_FOLDER), { recursive: true });
      } catch (error) {
        throw new StoreError(`Cannot create the runs folder in ${this.shown}: ${plainError(error)}`);
      }
      return fn();
    });
  }

  writeIndex(entries) {
    const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    writeJson(join(this.path, INDEX_FILE), { storeVersion: STORE_VERSION, runs: sorted });
  }

  // Saves results as new runs and returns their entries. Each item is { result, details }; see
  // metaFor() for the details. The run files are written before the index, so a save that is
  // killed part way leaves runs that reading still finds, never an entry with no run.
  addAll(items) {
    return this.writing(() => {
      const existing = this.entries();
      const taken = new Set(this.runIds());
      // Every result is checked before any is written, so a bad one adds nothing.
      const prepared = items.map(({ result, details }) => {
        const time = Date.parse(details.ranAt);
        if (!Number.isFinite(time)) throw new StoreError(`Cannot save a run: "${details.ranAt}" is not a time.`);
        const id = freeId(time, taken);
        taken.add(id);
        const meta = metaFor(id, result, details);
        return { meta, result, entry: entryFor(meta, upgradeResult(result, `Run ${id}`)) };
      });
      for (const { meta, result } of prepared) writeJson(this.runFile(meta.id), { storeVersion: STORE_VERSION, meta, result });
      const added = prepared.map(({ entry }) => entry);
      this.writeIndex([...existing, ...added]);
      return added;
    });
  }

  add(result, details) {
    return this.addAll([{ result, details }])[0];
  }

  // Removes runs. Their files go first: an index entry whose file is gone is left out on reading,
  // while a run file the index has lost would come back.
  remove(ids) {
    return this.writing(() => {
      const doomed = new Set(ids);
      const kept = this.entries().filter((entry) => !doomed.has(entry.id));
      for (const id of doomed) {
        try {
          rmSync(this.runFile(id), { force: true });
        } catch (error) {
          throw new StoreError(`Cannot remove run ${id}: ${plainError(error)}`);
        }
      }
      this.writeIndex(kept);
      return doomed.size;
    });
  }

  // Reads every run file and checks it, then checks the index against them. With `rebuild`, the
  // index is written again from the run files that could be read.
  verify({ rebuild = false } = {}) {
    if (this.version === 0) throw new StoreError(`There is no results store at ${this.shown}.`);
    const problems = [];
    const good = [];
    for (const id of this.runIds()) {
      try {
        const { meta, result } = this.load(id);
        good.push(entryFor(meta, result));
      } catch (error) {
        if (!(error instanceof StoreError)) throw error;
        problems.push({ run: id, message: error.message, index: false });
      }
    }
    if (this.version === 1) {
      for (const { file, reason, damaged } of this.legacyRuns().skipped) {
        if (damaged) problems.push({ run: null, message: `${file}: ${reason}`, index: false });
      }
      if (rebuild) throw new StoreError(`${this.shown} is a folder of JSON reports, which has no index to rebuild. Convert it with: builtcheck store migrate ${this.shown}`);
      return { runs: good.length, problems, rebuilt: false };
    }
    problems.push(...this.indexProblems(good));
    if (!rebuild) return { runs: good.length, problems, rebuilt: false };
    this.writing(() => {
      const readable = [];
      for (const id of this.runIds()) {
        try {
          const { meta, result } = this.load(id);
          readable.push(entryFor(meta, result));
        } catch (error) {
          if (!(error instanceof StoreError)) throw error;
        }
      }
      this.writeIndex(readable);
    });
    return { runs: good.length, problems: problems.filter((problem) => !problem.index), fixed: problems.filter((problem) => problem.index).length, rebuilt: true };
  }

  indexProblems(good) {
    const path = join(this.path, INDEX_FILE);
    if (!statSync(path, { throwIfNoEntry: false })) return [{ run: null, message: `${INDEX_FILE} is missing.`, index: true }];
    let index;
    try {
      index = readJson(path, INDEX_FILE);
    } catch (error) {
      return [{ run: null, message: error.message, index: true }];
    }
    if (!isObject(index) || !Array.isArray(index.runs)) return [{ run: null, message: `${INDEX_FILE} is damaged: it has no list of runs.`, index: true }];
    const problems = [];
    const listed = new Map(index.runs.filter(isObject).map((entry) => [entry.id, entry]));
    const files = new Set(this.runIds());
    for (const entry of good) {
      const found = listed.get(entry.id);
      if (!found) problems.push({ run: entry.id, message: `Run ${entry.id} is not in the index.`, index: true });
      else if (canonicalJson(found) !== canonicalJson(entry)) problems.push({ run: entry.id, message: `The index entry for run ${entry.id} does not match its run file.`, index: true });
    }
    for (const id of listed.keys()) {
      if (!files.has(id)) problems.push({ run: typeof id === "string" ? id : null, message: `The index lists run ${id}, which has no run file.`, index: true });
    }
    return problems;
  }

  // The bytes the store's own files take up.
  size() {
    const sizeOf = (path) => statSync(path, { throwIfNoEntry: false })?.size ?? 0;
    if (this.version === 1) return this.legacyRuns().runs.reduce((total, run) => total + sizeOf(join(this.path, run.file)), 0);
    if (this.version === 0) return 0;
    const files = [join(this.path, STORE_FILE), join(this.path, INDEX_FILE), ...this.runIds().map((id) => this.runFile(id))];
    return files.reduce((total, path) => total + sizeOf(path), 0);
  }
}
