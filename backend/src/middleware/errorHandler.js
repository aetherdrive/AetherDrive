/**
 * Global error handler middleware. It logs the error and sends a 500
 * response with a generic message. You can expand this to handle
 * different error types (validation errors, auth errors, etc.)
 */
export function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ ok: false, error: 'internal_server_error' });
  }
}