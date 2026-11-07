// A small glob matcher for config values: "*" stays within a path segment, "**" crosses
// segments and "?" is one character. Paths use forward slashes.

function escapeRegex(ch) {
  return /[.+^${}()|[\]\\]/.test(ch) ? `\\${ch}` : ch;
}

export function globToRegExp(glob) {
  let pattern = "^";
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          pattern += "(?:.*/)?";
          i += 3;
        } else {
          pattern += ".*";
          i += 2;
        }
      } else {
        pattern += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      pattern += "[^/]";
      i += 1;
    } else {
      pattern += escapeRegex(ch);
      i += 1;
    }
  }
  return new RegExp(`${pattern}$`);
}

// The ways people write a path to skip: "./drafts/**", "/drafts/**", "drafts\\**", "drafts/"
// and plain "drafts" all mean the same folder.
export function expandFileGlob(glob) {
  const clean = glob.trim().replace(/\\/g, "/").replace(/^(?:\.\/|\/)+/, "");
  if (clean.endsWith("/")) return [`${clean}**`];
  return /[*?]/.test(clean) ? [clean] : [clean, `${clean}/**`];
}

export function makeMatcher(globs) {
  const patterns = globs.map(globToRegExp);
  return (path) => patterns.some((pattern) => pattern.test(path));
}
