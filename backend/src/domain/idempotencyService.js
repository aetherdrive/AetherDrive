import fs from "fs";
import path from "path";
import crypto from "crypto";

const IDEM_PATH = path.resolve("data", "idempotency.json");

function ensureFile() {
  try { fs.accessSync(IDEM_PATH); }
  catch {
    fs.mkdirSync(path.dirname(IDEM_PATH), { recursive: true });
    fs.writeFileSync(IDEM_PATH, "[]", "utf8");
  }
}

function readAll() {
  ensureFile();
  const raw = fs.readFileSync(IDEM_PATH, "utf8") || "[]";
  return JSON.parse(raw);
}

function writeAll(items) {
  ensureFile();
  fs.writeFileSync(IDEM_PATH, JSON.stringify(items, null, 2), "utf8");
}

export function hashRequestBody(body) {
  const normalized = JSON.stringify(body ?? {}, Object.keys(body ?? {}).sort());
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * If an idempotency record exists for (key, endpoint, requestHash),
 * returns {hit:true, response}. Otherwise returns {hit:false}.
 */
export function checkIdempotency({ key, endpoint, requestHash }) {
  if (!key) return { hit: false };
  const all = readAll();
  const found = all.find(
    (r) => r.key === key && r.endpoint === endpoint && r.requestHash === requestHash
  );
  if (!found) return { hit: false };
  return { hit: true, response: found.response, status: found.status ?? 200 };
}

/**
 * Store response for a given idempotency key.
 */
export function storeIdempotency({ key, endpoint, requestHash, response, status = 200 }) {
  if (!key) return;
  const all = readAll();
  // Remove any mismatched hashes for same (key, endpoint) to avoid ambiguity
  const filtered = all.filter((r) => !(r.key === key && r.endpoint === endpoint));
  filtered.push({
    key,
    endpoint,
    requestHash,
    status,
    response,
    createdAt: new Date().toISOString(),
  });
  writeAll(filtered);
}
