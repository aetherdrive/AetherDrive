// utils/ids.js (ESM)
import crypto from "node:crypto";

export function newRequestId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

export function sha256(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}
