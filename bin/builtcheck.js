#!/usr/bin/env node
// Checks the Node version before loading anything newer than old versions can parse.

const [major] = process.versions.node.split(".").map(Number);
if (major < 18) {
  process.stderr.write(`builtcheck needs Node.js 18 or newer. This is Node.js ${process.versions.node}.\n`);
  process.exit(2);
}

// When a reader such as "head" stops early, leave quietly with the result already decided.
// Linux reports that as EPIPE, and Windows as EPIPE or EOF.
process.stdout.on("error", (error) => {
  if (error.code !== "EPIPE" && error.code !== "EOF") throw error;
  process.exit(process.exitCode ?? 0);
});

// A long-running command such as a server gives a promise of its exit code.
import("../src/cli.js")
  .then(({ main }) =>
    main(process.argv.slice(2), {
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
      isTty: process.stdout.isTTY,
    }),
  )
  .then((code) => {
    process.exitCode = code;
  });
