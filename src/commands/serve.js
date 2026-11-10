// builtcheck serve: a local web page for browsing saved runs, comparing them and, with --site,
// starting new audits. It runs until Ctrl+C, so run() returns a promise of the exit code.

import { resolve } from "node:path";
import { loadConfig, requireFolder, UsageError } from "../cli.js";
import { resolveConfig } from "../engine/config.js";
import { printable } from "../report/printable.js";
import { allRules } from "../rules/index.js";
import { DEFAULT_HOST, DEFAULT_PORT, startServer } from "../server/index.js";
import { bindAddress, isLoopback } from "../server/security.js";
import { checkSaveTarget, DEFAULT_STORE, openStore } from "../store/index.js";
import { readOptions, wholeNumber } from "../store/command-line.js";

export const summary = "Browse saved runs in a local web page, and start audits from it";

export const usage = `builtcheck serve: browse saved runs in a local web page.

Usage:
  builtcheck serve [options]

It prints the address to open, and runs until you press Ctrl+C. The page lists the saved runs
with a chart of errors and warnings over time, shows each run's findings with filters, compares
two runs, and describes every rule. The same data is in a JSON API under /api/.

Options:
  --port <n>         The port to listen on (default: ${DEFAULT_PORT}). 0 picks a free port
  --host <address>   The address to listen on (default: ${DEFAULT_HOST}, this computer only)
  --site <folder>    Let the page start audits of this built site folder, saved in the store
  --store <folder>   The results store folder (default: .builtcheck in the current folder)
  --config <file>    Config file to read "store.path" and, for audits, the settings from
  --no-config        Ignore any config file
  --help, -h         Print this help

Exit codes: 0 when it stopped after Ctrl+C; 2 when it could not start.
`;

function portFrom(options) {
  if (options.port === undefined) return DEFAULT_PORT;
  const port = wholeNumber(options.port, "--port");
  if (port > 65535) throw new UsageError(`--port must be from 0 to 65535, not ${options.port}`);
  return port;
}

function addressFrom(options) {
  if (options.host === undefined) return DEFAULT_HOST;
  const address = bindAddress(options.host);
  if (!address) throw new UsageError(`--host must be an IP address, such as 127.0.0.1 or ::1, or localhost, not "${printable(options.host)}"`);
  return address;
}

// Why the server could not listen, in words.
function listenProblem(error, address, port) {
  const where = `${address.includes(":") ? `[${address}]` : address}:${port}`;
  if (error.code === "EADDRINUSE") return `port ${port} on ${address} is in use by another program. Choose another with --port, or --port 0 for any free port.`;
  if (error.code === "EACCES" || error.code === "EPERM") return `this user may not listen on ${where}. Choose a port above 1023 with --port.`;
  if (error.code === "EADDRNOTAVAIL") return `${address} is not an address of this computer, so nothing can listen on it. Leave out --host to use ${DEFAULT_HOST}.`;
  return `could not listen on ${where}: ${error.message}`;
}

export function run(argv, io) {
  const options = readOptions("serve", argv, { values: ["port", "host", "site"] });
  if (options.help) {
    io.stdout(usage);
    return 0;
  }
  if (options.positional.length > 0) throw new UsageError("builtcheck serve takes no folder, only options. To let the page audit a site, give --site <folder>.");
  if (options.format !== undefined) throw new UsageError("builtcheck serve has no --format. Every format can be downloaded from the page.");
  const port = portFrom(options);
  const address = addressFrom(options);

  // Everything that could stop an audit later is checked now, so a mistake shows at once.
  const config = loadConfig({ config: options.config, "no-config": options["no-config"] });
  resolveConfig(config, allRules);
  const storeShown = options.store ?? config?.store?.path ?? DEFAULT_STORE.path;
  const store = openStore(storeShown);
  if (options.site !== undefined) {
    const root = requireFolder(options.site);
    checkSaveTarget({ root, store: { ...(config?.store ?? {}), path: storeShown }, config });
  }

  return startServer({
    store: store.path,
    storeShown,
    address,
    port,
    site: options.site ?? null,
    config: options.config ? resolve(options.config) : null,
    noConfig: Boolean(options["no-config"]),
  }).then(
    (server) => {
      if (!isLoopback(address)) {
        io.stderr(`builtcheck: warning: listening on ${address}, so other computers that can reach this one can open the page. Anyone who can reach it can read every saved run${options.site ? " and start audits" : ""}. Leave out --host to keep it to this computer.\n`);
      }
      io.stdout(`builtcheck: serving the results store ${printable(storeShown)} at ${server.url}\n`);
      if (options.site) io.stdout(`builtcheck: the page can start audits of ${printable(options.site)}\n`);
      io.stdout("builtcheck: press Ctrl+C to stop\n");
      return new Promise((done) => {
        const stop = () => {
          process.off("SIGINT", stop);
          process.off("SIGTERM", stop);
          server.close().then(() => {
            io.stdout("builtcheck: stopped\n");
            done(0);
          });
        };
        process.on("SIGINT", stop);
        process.on("SIGTERM", stop);
      });
    },
    (error) => {
      io.stderr(`builtcheck: ${printable(listenProblem(error, address, port))}\n`);
      return 2;
    },
  );
}
