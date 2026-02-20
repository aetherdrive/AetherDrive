import { Router } from "express";

/*
 * Simple in-memory rate limiting middleware.
 * Tracks number of requests per IP within a time window and returns HTTP 429
 * when the limit is exceeded. This provides basic protection against
 * brute-force attacks and accidental overload. For production use, consider
 * a distributed store like Redis.
 *
 * Options:
 *   windowMs: duration of the time window in milliseconds (default 10 minutes)
 *   max: maximum number of requests allowed per IP within the window (default 100)
 */
export function rateLimit(options = {}) {
  const windowMs = options.windowMs ?? 10 * 60 * 1000; // 10 minutes
  const max = options.max ?? 100;
  const requests = new Map();
  return function (req, res, next) {
    const now = Date.now();
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    let entry = requests.get(ip);
    if (!entry) {
      entry = { count: 1, start: now };
      requests.set(ip, entry);
      return next();
    }
    if (now - entry.start > windowMs) {
      // Reset window for this IP
      entry.count = 1;
      entry.start = now;
      requests.set(ip, entry);
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ ok: false, error: "rate_limit_exceeded" });
    }
    next();
  };
}