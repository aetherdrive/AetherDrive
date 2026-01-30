/**
 * Simple role-based access control middleware.
 *
 * Usage: requireRole(["employer_admin", "accountant"])
 * A request must include the header `X-User-Role` with one of the
 * allowed role strings; otherwise the request is rejected with HTTP 403.
 *
 * In a real-world application, roles would be derived from an
 * authentication/authorisation token rather than a plain header.
 */
export function requireRole(roles = []) {
  return function (req, res, next) {
    const role = req.header("X-User-Role");
    if (!role || (roles.length > 0 && !roles.includes(role))) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }
    next();
  };
}