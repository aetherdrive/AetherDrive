import jwt from "jsonwebtoken";

function requireJwt() {
  if (process.env.REQUIRE_JWT) return String(process.env.REQUIRE_JWT).toLowerCase() === "true";
  return String(process.env.NODE_ENV || "").toLowerCase() === "production";
}

export function authenticate(req, res, next) {
  const must = requireJwt();
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    if (must) return res.status(500).json({ ok: false, error: "jwt_not_configured" });
    return next();
  }

  const auth = req.headers["authorization"] || "";
  if (!auth.startsWith("Bearer ")) {
    if (must) return res.status(401).json({ ok: false, error: "missing_token" });
    return next();
  }

  try {
    req.user = jwt.verify(auth.slice(7), secret);
    return next();
  } catch {
    if (must) return res.status(401).json({ ok: false, error: "invalid_token" });
    return next();
  }
}
