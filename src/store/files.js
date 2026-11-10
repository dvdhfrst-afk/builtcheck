// File handling for the results store. Every write is whole or not at all: it goes to a temporary
// file beside the target and is renamed over it, as reports are. Saving takes a lock, so two runs
// saving at once cannot both read the index, add to it, and lose one of the two entries.

import { closeSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { plainError } from "../cli.js";

export class StoreError extends Error {}

export const LOCK_FILE = "lock";
const LOCK_WAIT_MS = 10000;
const LOCK_POLL_MS = 20;
// Saving takes milliseconds, so a lock this old was left behind by a run that was killed.
const LOCK_STALE_MS = 30000;

const sleeper = new Int32Array(new SharedArrayBuffer(4));

// Waits without a timer, since every store operation is synchronous like the audit itself.
export function pause(ms) {
  Atomics.wait(sleeper, 0, 0, ms);
}

// Windows refuses a rename for a moment while another program, such as a second builtcheck
// reading the index, has the target open. Such a refusal passes quickly, so it is worth retrying.
function retried(action) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return action();
    } catch (error) {
      if (attempt >= 25 || process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      pause(20);
    }
  }
}

export function moveFile(from, to) {
  retried(() => renameSync(from, to));
}

let written = 0;

export function writeWhole(path, text) {
  written += 1;
  // A leading dot keeps a leftover temporary file out of every listing the store makes.
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${written}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: "wx" });
    moveFile(temporary, path);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // The folder itself may be what failed, and then there is nothing to remove.
    }
    throw new StoreError(`Cannot write ${path}: ${plainError(error)}`);
  }
}

export function writeJson(path, value) {
  writeWhole(path, `${JSON.stringify(value, null, 2)}\n`);
}

// Some shells write redirected output as UTF-16 with a byte order mark, so a report saved with
// "> report.json" in Windows PowerShell reads correctly too.
export function decode(buffer) {
  const text = buffer[0] === 0xff && buffer[1] === 0xfe ? buffer.toString("utf16le") : buffer.toString("utf8");
  return text.replace(/^﻿/, "");
}

// Reads and parses one JSON file. `what` names it for the message, as in "Run 20261109-101500-000".
export function readJson(path, what) {
  let text;
  try {
    text = decode(readFileSync(path));
  } catch (error) {
    throw new StoreError(`Cannot read ${what}: ${plainError(error)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new StoreError(`${what} is damaged: it is not valid JSON.`), { damaged: true });
  }
}

// Removes a lock older than any save could take. It is renamed first, so of two runs that both
// find it stale, only one removes it; the other sees it gone and tries again.
function clearStaleLock(lock) {
  let stat;
  try {
    stat = statSync(lock);
  } catch {
    return true;
  }
  if (Date.now() - stat.mtimeMs < LOCK_STALE_MS) return false;
  const aside = `${lock}.${process.pid}.stale`;
  try {
    moveFile(lock, aside);
    rmSync(aside, { force: true });
  } catch {
    // Another run took it first.
  }
  return true;
}

// Runs `fn` while holding the store's lock, waiting a while for another run to finish with it.
export function withLock(folder, fn, waitMs = LOCK_WAIT_MS) {
  const lock = join(folder, LOCK_FILE);
  const deadline = Date.now() + waitMs;
  for (;;) {
    let descriptor;
    try {
      descriptor = openSync(lock, "wx");
    } catch (error) {
      // Windows reports a lock that is being removed as a permission error, which passes.
      const held = error.code === "EEXIST" || (process.platform === "win32" && error.code === "EPERM");
      if (!held) throw new StoreError(`Cannot lock the results store at ${folder}: ${plainError(error)}`);
      if (clearStaleLock(lock) && error.code === "EEXIST") continue;
      if (Date.now() > deadline) {
        throw new StoreError(`The results store at ${folder} is busy: another builtcheck has held it for over ${Math.ceil(waitMs / 1000)} seconds. If none is running, delete ${lock} and try again.`);
      }
      pause(LOCK_POLL_MS);
      continue;
    }
    try {
      writeSync(descriptor, `${JSON.stringify({ pid: process.pid, since: new Date().toISOString() })}\n`);
    } finally {
      closeSync(descriptor);
    }
    break;
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}
