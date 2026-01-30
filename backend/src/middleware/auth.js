/*
 * Optional JWT authentication middleware.
 * If jsonwebtoken or JWT_SECRET is missing, auth is bypassed (safe for early-stage deploy).
 */
let jwt = null;
try {
  jwt = await import('jsonwebtoken');
} catch (e) {
  console.warn('jsonwebtoken not installed, auth middleware running in passthrough mode');
}

export function authenticate(req, res, next) {
  if (!jwt || !process.env.JWT_SECRET) {
    return next();
  }
  const auth = req.headers['authorization'] || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'missing_token' });
  }
  const token = auth.slice(7);
  try {
    req.user = jwt.default.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'invalid_token' });
  }
}
