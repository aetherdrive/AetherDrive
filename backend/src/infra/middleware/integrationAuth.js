import crypto from "crypto";

const ALLOW_INSECURE_INTEGRATIONS = String(
  process.env.PB_ALLOW_INSECURE_INTEGRATIONS || "false"
).toLowerCase() === "true";

function toBuffer(value) {
  return Buffer.from(String(value || ""), "utf8");
}

function keysMatch(expected, provided) {
  const expectedBuf = toBuffer(expected);
  const providedBuf = toBuffer(provided);

  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export function getIntegrationKey() {
  return process.env.INTEGRATION_KEY || null;
}

export function assertIntegrationConfiguration() {
  const integrationKey = getIntegrationKey();
  if (!integrationKey && !ALLOW_INSECURE_INTEGRATIONS) {
    throw new Error(
      "Missing INTEGRATION_KEY environment variable. Set this to a strong shared secret to allow integration requests."
    );
  }
}

export function requireIntegrationKey(req, res, next) {
  const expectedKey = getIntegrationKey();

  if (!expectedKey && ALLOW_INSECURE_INTEGRATIONS) {
    return next();
  }

  const provided = req.header("X-PAYBRIDGE-KEY") || "";
  if (!keysMatch(expectedKey || "", provided)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  return next();
}