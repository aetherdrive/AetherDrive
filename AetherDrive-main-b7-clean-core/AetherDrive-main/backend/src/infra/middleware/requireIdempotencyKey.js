export function requireIdempotencyKey(req, res, next) {
  const method = (req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return next();

  const key = req.header("X-Idempotency-Key") || req.header("x-idempotency-key");
  if (!key || String(key).trim().length < 8) {
    return res.status(400).json({ ok: false, error: "idempotency_key_required" });
  }
  next();
}
