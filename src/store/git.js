// The branch and commit of the git repository holding the current folder, so a saved run can be
// tied to the source it was built from. Read from the files git keeps, since builtcheck starts no
// processes. Anything unexpected gives null: this is a convenience, never a reason to fail.

import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const SMALL = 4096;
const PACKED_REFS_LIMIT = 64 * 1024 * 1024;

function readLimited(path, limit) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > limit) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function kindOf(path) {
  try {
    const stat = statSync(path);
    return stat.isDirectory() ? "folder" : stat.isFile() ? "file" : null;
  } catch {
    return null;
  }
}

// A worktree or submodule has a .git file naming the real folder.
function findGitFolder(start) {
  for (let folder = resolve(start); ; folder = dirname(folder)) {
    const candidate = join(folder, ".git");
    const kind = kindOf(candidate);
    if (kind === "folder") return candidate;
    if (kind === "file") {
      const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(readLimited(candidate, SMALL) ?? "");
      return pointer ? resolve(folder, pointer[1]) : null;
    }
    if (dirname(folder) === folder) return null;
  }
}

// A worktree keeps its own HEAD but shares branches with the main repository.
function sharedFolder(gitFolder) {
  const pointer = readLimited(join(gitFolder, "commondir"), SMALL)?.trim();
  return pointer ? resolve(gitFolder, pointer) : gitFolder;
}

function commitOf(gitFolder, ref) {
  if (ref.split("/").some((part) => part === ".." || part === "")) return null;
  const shared = sharedFolder(gitFolder);
  for (const folder of new Set([gitFolder, shared])) {
    const hash = readLimited(join(folder, ...ref.split("/")), SMALL)?.trim();
    if (hash && HASH.test(hash)) return hash;
  }
  // Branches git has packed are lines of "<hash> <ref>".
  for (const line of (readLimited(join(shared, "packed-refs"), PACKED_REFS_LIMIT) ?? "").split("\n")) {
    const [hash, name] = line.trim().split(" ");
    if (name === ref && HASH.test(hash)) return hash;
  }
  return null;
}

// { branch, commit }, with branch null for a detached HEAD and commit null on a branch with no
// commits yet, or null outside a repository.
export function gitState(cwd) {
  const gitFolder = findGitFolder(cwd);
  if (!gitFolder) return null;
  const head = readLimited(join(gitFolder, "HEAD"), SMALL)?.trim();
  if (!head) return null;
  if (HASH.test(head)) return { branch: null, commit: head };
  const ref = /^ref:\s*(refs\/\S+)$/.exec(head)?.[1];
  if (!ref) return null;
  return { branch: ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref, commit: commitOf(gitFolder, ref) };
}
