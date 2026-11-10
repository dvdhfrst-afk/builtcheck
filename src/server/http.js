// What every response of the local server shares: its security headers, JSON bodies and errors,
// and reading a capped request body. See SECURITY.md for why each header is there.

export const API_VERSION = 1;

// The largest request body read. The only body the API takes is a short JSON object.
export const MAX_BODY_BYTES = 16 * 1024;

// An error the API reports to the client as it is: a status code and a plain message.
export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

// Pages may load scripts, styles and data from this server only, and nothing may frame them.
export const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// Data and downloads are never documents: if one is opened directly, it can run and load nothing.
export const DATA_POLICY = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

// Sent with every response. There are no CORS headers, on purpose: no other site may read these.
export function securityHeaders(policy = DATA_POLICY) {
  return {
    "Content-Security-Policy": policy,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
  };
}

export function send(response, status, body, headers = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  response.writeHead(status, { ...securityHeaders(), "Content-Length": buffer.length, ...headers });
  response.end(buffer);
}

export function sendJson(response, status, value, headers = {}) {
  send(response, status, `${JSON.stringify({ apiVersion: API_VERSION, ...value })}\n`, { "Content-Type": "application/json; charset=utf-8", ...headers });
}

export function sendError(response, status, message, headers = {}) {
  sendJson(response, status, { error: { status, message } }, headers);
}

// Reads the body of a request whole, refusing one larger than `limit` without reading the rest.
export function readBody(request, limit = MAX_BODY_BYTES) {
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > limit) {
    return Promise.reject(new HttpError(413, `The request body is over ${limit} bytes, the most this server reads.`));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        reject(new HttpError(413, `The request body is over ${limit} bytes, the most this server reads.`));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", (error) => {
      if (!failed) reject(error);
    });
  });
}

// A JSON object from the body, or {} for an empty body. `allowed` names the fields it may hold.
export function parseJsonObject(text, allowed) {
  if (text.trim() === "") return {};
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "The request body is not valid JSON.");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "The request body must be a JSON object.");
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new HttpError(400, `The request body has a field this route does not take: ${unknown[0].slice(0, 40)}. It takes ${allowed.length > 0 ? allowed.join(", ") : "none"}.`);
  }
  return value;
}
