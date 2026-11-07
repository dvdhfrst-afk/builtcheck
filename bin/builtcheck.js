#!/usr/bin/env node
// Checks the Node version before loading anything newer than old versions can parse.

const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  process.stderr.write(`builtcheck needs Node.js 18 or newer. This is Node.js ${process.versions.node}.\n`);
  process.exit(2);
}

// When a reader such as "head" stops early, leave quietly with the result already decided.
process.stdout.on("error", (error) => {
  if (error.code !== "EPIPE") throw error;
  process.exit(process.exitCode ?? 0);
});

import("../src/cli.js").then(({ main }) => {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    isTty: process.stdout.isTTY,
  });
});
