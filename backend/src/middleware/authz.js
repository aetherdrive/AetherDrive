export function requireRole(allowedRoles = []) {
  return (req, res, next) => {
    const role = (req.user && req.user.role) ? String(req.user.role) : (req.header("X-User-Role") || "");
    if (!allowedRoles.includes(role)) return res.status(403).json({ ok: false, error: "forbidden" });
    return next();
  };
}
