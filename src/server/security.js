// The checks that keep the local server for the person who started it: which Host headers it
// answers, and what a request that changes something must carry. See SECURITY.md.

import { randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";
import { HttpError } from "./http.js";

export const TOKEN_HEADER = "x-builtcheck-token";

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:.]+$/i;

// The address --host names, as the server binds it. Only addresses are taken, never other host
// names, so binding needs no name lookup and the server is where the user said.
export function bindAddress(text) {
  const value = text.trim().toLowerCase();
  if (value === "localhost") return "127.0.0.1";
  const ipv4 = IPV4.exec(value);
  if (ipv4) {
    if (ipv4.slice(1).every((part) => Number(part) <= 255)) return value;
    return null;
  }
  const bare = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  if (bare.includes(":") && IPV6.test(bare)) return bare;
  return null;
}

export function isLoopback(address) {
  return /^127\./.test(address) || address === "::1" || /^::ffff:127\./.test(address);
}

export function isWildcard(address) {
  return address === "0.0.0.0" || address === "::";
}

// How an address is written in a URL or a Host header.
export function hostName(address) {
  return address.includes(":") ? `[${address}]` : address;
}

// Every Host header the server answers: the address it is bound to and, for a loopback address,
// localhost. A rebinding attack points a name the attacker controls at this address, and the
// browser then sends that name, which is not on this list. Bound to every address, the server
// answers to the addresses this computer has.
export function allowedHosts(address, port) {
  const names = new Set();
  if (isWildcard(address)) {
    names.add("localhost");
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) names.add(hostName(entry.address.toLowerCase()));
    }
    names.add("127.0.0.1");
    names.add("[::1]");
  } else {
    names.add(hostName(address));
    if (isLoopback(address)) names.add("localhost");
  }
  const allowed = new Set();
  for (const name of names) {
    allowed.add(`${name}:${port}`);
    // Browsers leave out the port when it is the default one.
    if (port === 80) allowed.add(name);
  }
  return allowed;
}

export function checkHost(request, allowed) {
  const host = request.headers.host;
  if (!host) throw new HttpError(400, "The request has no Host header.");
  if (!allowed.has(host.toLowerCase())) {
    throw new HttpError(403, `This server does not answer to the host name ${host.slice(0, 100)}. Open it at the address builtcheck serve printed. Other names are refused so that another site cannot reach it through a name of its own.`);
  }
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

function sameToken(given, token) {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A request that changes something must say it is JSON, which a plain form on another site cannot
// send without asking first, must carry the token from this server's own page, which another site
// cannot read, and must not come from a page on another origin.
export function checkChange(request, token, allowed) {
  const type = (request.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Send the request body as JSON, with Content-Type: application/json.");
  if (!sameToken(request.headers[TOKEN_HEADER], token)) {
    throw new HttpError(403, `The request lacks this server's token. Send the token from the page's builtcheck-token meta tag in the ${TOKEN_HEADER} header.`);
  }
  const origin = request.headers.origin;
  if (origin !== undefined && !(origin.startsWith("http://") && allowed.has(origin.slice("http://".length).toLowerCase()))) {
    throw new HttpError(403, "The request comes from a page on another site, so it is refused.");
  }
}
