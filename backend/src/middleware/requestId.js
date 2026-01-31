import crypto from "crypto";

/**
 * Attaches a request id to every request for traceability.
 * - Sets req.requestId
 * - Adds response header X-Request-Id
 */
export function requestId(req, res, next) {
  const id = req.header("X-Request-Id") || crypto.randomUUID();
  req.requestId = id;
  res.set("X-Request-Id", id);
  next();
}
