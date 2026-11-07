#!/usr/bin/env node
import { main } from "../src/cli.js";

process.exitCode = main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  isTty: process.stdout.isTTY,
});
