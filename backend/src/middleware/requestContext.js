// middleware/requestContext.js (ESM)
import { newRequestId } from "../utils/ids.js";

export function requestContext(req, res, next) {
  const requestId = req.header("X-Request-Id") || newRequestId();
  req.ctx = { request_id: requestId, ip: req.ip, user_agent: req.header("User-Agent") || null };
  res.setHeader("X-Request-Id", requestId);
  next();
}
