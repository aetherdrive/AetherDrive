/*
 * Authentication and authorisation middleware.
 *
 * In a production system, you would verify a JWT token signed by your
 * identity provider (e.g. Auth0, Azure AD). Here we provide a simple
 * implementation that expects an Authorization header of the form
 * `Bearer <token>` and verifies it with jsonwebtoken. The token should
 * contain a `role` claim that maps to your RBAC roles.
 */
import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || null;

export function authenticate(req, res, next) {
  const authHeader = req.header('Authorization');
  if (!SECRET) {
    return res.status(500).json({ ok: false, error: 'jwt_secret_not_configured' });
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'missing_token' });
  }
  const token = authHeader.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, SECRET);
    req.user = {
      id: payload.sub,
      role: payload.role
    };
    return next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}

/**
 * Role-based authorisation. Wrap this around routes to require a set
 * of allowed roles. Relies on `authenticate` to populate req.user.
 */
export function requireRoles(roles = []) {
  return function (req, res, next) {
    const userRole = req.user?.role;
    if (!userRole || (roles.length > 0 && !roles.includes(userRole))) {
      return res.status(403).json({ ok: false, error: 'forbidden' });
    }
    next();
  };
}