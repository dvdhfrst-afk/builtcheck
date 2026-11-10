// Audits started from the web page. Each runs the same audit and save as `builtcheck <folder>
// --save`, in a worker thread so the server keeps answering while it runs, and one at a time.

import { Worker } from "node:worker_threads";
import { audit } from "../audit.js";
import { loadConfig, plainError, requireFolder, UsageError } from "../cli.js";
import { ConfigError } from "../engine/config.js";
import { allRules } from "../rules/index.js";
import { checkLabel, checkSaveTarget, saveRun, StoreError } from "../store/index.js";
import { HttpError } from "./http.js";

// Runs one audit and saves it. `job` holds what the server was started with: the site folder as
// given and resolved, the config file or noConfig, the store's absolute path, the label and the
// folder to work from. Returns an outcome, never throws, so a worker can always report back.
export function runAudit(job) {
  const startedAt = Date.now();
  try {
    const root = requireFolder(job.site);
    // Read on every audit, so a change made to the config while fixing the site applies.
    const config = loadConfig({ config: job.config ?? undefined, "no-config": job.noConfig });
    const store = { ...(config?.store ?? {}), path: job.store };
    checkSaveTarget({ root, store, config, label: job.label, cwd: job.cwd });
    const result = audit(root, config, allRules);
    const messages = result.skipped.filter((entry) => entry.incomplete).map(({ file, reason }) => `${file}: ${reason}`);
    if (result.summary.pages === 0) {
      return { ok: false, message: `There are no HTML pages in ${job.site} that could be read, so nothing was saved. Point builtcheck serve --site at the build output, and run the build first.`, messages };
    }
    result.root = job.site;
    const saved = saveRun(result, { root, folder: job.site, store, config, label: job.label, cwd: job.cwd, now: startedAt });
    return { ok: true, run: saved.id, errors: result.summary.errors, warnings: result.summary.warnings, complete: result.complete, messages };
  } catch (error) {
    if (error instanceof UsageError || error instanceof ConfigError || error instanceof StoreError) return { ok: false, message: error.message, messages: [] };
    if (error.code) return { ok: false, message: `Could not read the site folder: ${plainError(error)}`, messages: [] };
    return { ok: false, message: `This is a bug in builtcheck, not in your site: ${error.message}`, messages: [] };
  }
}

// Runs an audit in a worker thread. Returns { done, cancel }: a promise of the outcome, and a
// way to stop the worker when the server stops.
export function auditInWorker(job) {
  const worker = new Worker(new URL("./audit-worker.js", import.meta.url), { workerData: job });
  const done = new Promise((resolve) => {
    let answered = false;
    const answer = (outcome) => {
      if (answered) return;
      answered = true;
      resolve(outcome);
    };
    worker.once("message", answer);
    worker.once("error", (error) => answer({ ok: false, message: `The audit stopped: ${error.message}`, messages: [] }));
    worker.once("exit", (code) => answer({ ok: false, message: `The audit stopped before it finished (exit code ${code}).`, messages: [] }));
  });
  return { done, cancel: () => worker.terminate() };
}

// The audit the page can start, and what became of the last one. `site` is null when the server
// was started without --site, and then audits are off.
export class Audits {
  constructor({ site = null, config = null, noConfig = false, store, cwd = process.cwd(), runner = auditInWorker }) {
    this.settings = { site, config, noConfig, store, cwd };
    this.runner = runner;
    this.current = null;
    this.last = null;
    this.count = 0;
  }

  get enabled() {
    return this.settings.site !== null;
  }

  status() {
    const job = this.current ?? this.last;
    const base = { enabled: this.enabled, site: this.settings.site, running: this.current !== null };
    if (!job) return { ...base, audit: null };
    const { handle, finished, ...shown } = job;
    return { ...base, audit: shown };
  }

  start(label) {
    if (!this.enabled) throw new HttpError(403, "This server was started without --site, so it cannot start audits. Start it with builtcheck serve --site <folder>.");
    if (this.current) throw new HttpError(409, `An audit of ${this.settings.site} is already running. Wait for it to finish.`);
    let checked;
    try {
      checked = checkLabel(label);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    this.count += 1;
    const job = { number: this.count, state: "running", label: checked, startedAt: new Date().toISOString(), finishedAt: null, run: null, errors: null, warnings: null, complete: null, message: null, messages: [] };
    job.handle = this.runner({ ...this.settings, label: checked });
    this.current = job;
    job.finished = job.handle.done.then((outcome) => {
      Object.assign(job, {
        state: outcome.ok ? "finished" : "failed",
        finishedAt: new Date().toISOString(),
        run: outcome.run ?? null,
        errors: outcome.errors ?? null,
        warnings: outcome.warnings ?? null,
        complete: outcome.complete ?? null,
        message: outcome.message ?? null,
        messages: outcome.messages ?? [],
      });
      this.last = job;
      if (this.current === job) this.current = null;
    });
    return this.status();
  }

  // Stops a running audit, when the server stops. Nothing was saved yet unless it had finished.
  async stop() {
    if (this.current) await this.current.handle.cancel();
  }
}
