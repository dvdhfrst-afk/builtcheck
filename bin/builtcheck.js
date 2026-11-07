#!/usr/bin/env node
import { main } from "../src/cli.js";

// When a reader such as "head" stops early, leave quietly with the result already decided.
process.stdout.on("error", (error) => {
  if (error.code !== "EPIPE") throw error;
  process.exit(process.exitCode ?? 0);
});

process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTty: process.stdout.isTTY,
});
