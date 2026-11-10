// The worker thread an audit started from the web page runs in, so the server keeps answering
// while a large site is audited. See audits.js.

import { parentPort, workerData } from "node:worker_threads";
import { runAudit } from "./audits.js";

parentPort.postMessage(runAudit(workerData));
