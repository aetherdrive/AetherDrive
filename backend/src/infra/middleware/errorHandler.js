/**
 * Global error handler middleware. It logs the error and sends a 500
 * response with a generic message. You can expand this to handle
 * different error types (validation errors, auth errors, etc.)
 */
export function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  if (!res.headersSent) {
    const status = Number(err?.status) || 500;
    const code =
      (typeof err?.code === "string" && err.code) ||
      (typeof err?.message === "string" && err.message) ||
      "internal_server_error";
    res.status(status).json({ ok: false, error: code });
  }
}