// The local web server behind `builtcheck serve`: a page for browsing saved runs, and the JSON
// API it reads. It is the one part of builtcheck that opens a port, and it binds to the loopback
// address unless told otherwise. See docs/web.md and SECURITY.md.

import { createServer } from "node:http";
import { Store } from "../store/store.js";
import { handleApi } from "./api.js";
import { Audits } from "./audits.js";
import { HttpError, PAGE_POLICY, send, sendError, sendJson } from "./http.js";
import { isPagePath, pageHtml, staticFile } from "./page.js";
import { allowedHosts, checkChange, checkHost, hostName, isWildcard, newToken } from "./security.js";

export const DEFAULT_PORT = 7750;
export const DEFAULT_HOST = "127.0.0.1";

// Starts the server and resolves once it listens. Options:
//   store, storeShown  the store folder's absolute path, and as the user gave it
//   address, port      where to listen; port 0 picks a free port
//   site               the site folder as given, so the page can start audits; null turns them off
//   config, noConfig   the config file audits read, or none
//   cwd                the folder relative paths are read from
//   runner             runs one audit (tests pass their own)
// Resolves to { url, address, port, token, audits, close }.
export function startServer({ store, storeShown = store, address = DEFAULT_HOST, port = DEFAULT_PORT, site = null, config = null, noConfig = false, cwd = process.cwd(), runner } = {}) {
  const token = newToken();
  const audits = new Audits({ site, config, noConfig, store, cwd, ...(runner ? { runner } : {}) });
  let allowed = new Set();
  const context = {
    audits,
    // Opened again for every request, so runs saved from a terminal meanwhile are seen.
    openStore: () => new Store(store, storeShown),
    checkChange: (request) => checkChange(request, token, allowed),
  };
  const page = () => pageHtml({ token, store: storeShown, site });

  async function respond(request, response) {
    checkHost(request, allowed);
    const url = new URL(request.url ?? "/", "http://builtcheck.invalid");
    const path = url.pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      const reply = await handleApi(context, request.method, path.slice("/api".length), url.searchParams, request);
      if (reply.download) {
        send(response, 200, reply.download.body, { "Content-Type": reply.download.type, "Content-Disposition": `attachment; filename="${reply.download.name}"` });
      } else {
        sendJson(response, reply.status, reply.body);
      }
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, `${path} takes GET requests, not ${request.method}.`, { Allow: "GET, HEAD" });
    const file = staticFile(path);
    if (file) {
      send(response, 200, file.body, { "Content-Type": file.type });
      return;
    }
    // Any other path gets the page with 404, and the page says it found nothing there.
    send(response, isPagePath(path) ? 200 : 404, page(), { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": PAGE_POLICY });
  }

  const server = createServer((request, response) => {
    respond(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      if (error instanceof HttpError) sendError(response, error.status, error.message, error.headers);
      else sendError(response, 500, `This is a bug in builtcheck, not in your site or store: ${error.message}`);
    });
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 20000;

  // Stopping closes open connections too, since a browser keeps them alive.
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, address, () => {
      server.off("error", reject);
      const bound = server.address().port;
      allowed = allowedHosts(address, bound);
      const shown = isWildcard(address) ? (address === "::" ? "::1" : "127.0.0.1") : address;
      resolve({
        url: `http://${hostName(shown)}:${bound}/`,
        address,
        port: bound,
        token,
        audits,
        close: async () => {
          await audits.stop();
          await new Promise((done) => {
            server.close(() => done());
            for (const socket of sockets) socket.destroy();
          });
        },
      });
    });
  });
}
