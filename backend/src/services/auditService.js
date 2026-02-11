// services/auditService.js (ESM)
import fs from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../utils/ids.js";

const DEFAULT_FILE = process.env.PB_AUDIT_FILE || "/tmp/paybridge_audit.jsonl";

export const AUDIT_EVENT = Object.freeze({
  RUN_CREATE: "run_create",
  RUN_IMPORT: "run_import",
  RUN_CALCULATE: "run_calculate",
  RUN_APPROVE: "run_approve",
  RUN_COMMIT: "run_commit",
  RUN_RECONCILE: "run_reconcile",
  INTEGRATION_PULL: "integration_pull",
  INTEGRATION_WEBHOOK: "integration_webhook",
  INTEGRATION_WRITEBACK: "integration_writeback",
  AUTH_SUCCESS: "auth_success",
  AUTH_FAILURE: "auth_failure",
  ERROR: "error"
});

function nowISO() { return new Date().toISOString(); }
function safeJson(obj) { return JSON.parse(JSON.stringify(obj ?? {})); }

export async function appendAuditEvent(event, { prevHash = "" } = {}) {
  const payload = safeJson(event);
  const payloadHash = sha256(JSON.stringify(payload));
  const chainHash = sha256(prevHash + payloadHash);
  const record = { ...payload, payload_hash: payloadHash, chain_hash: chainHash };
  await fs.mkdir(path.dirname(DEFAULT_FILE), { recursive: true });
  await fs.appendFile(DEFAULT_FILE, JSON.stringify(record) + "\n", "utf8");
  return chainHash;
}

export async function recordEvent({ type, company_id, run_id = null, actor = {}, details = {}, ctx = {}, prev_hash = "" }) {
  if (!type) throw new Error("audit_missing_type");
  if (!company_id) throw new Error("audit_missing_company_id");

  const event = {
    ts: nowISO(),
    type,
    company_id: String(company_id),
    run_id: run_id ? String(run_id) : null,
    request_id: ctx?.request_id || null,
    actor: { role: actor?.role || null, subject: actor?.subject || null },
    ip: actor?.ip || ctx?.ip || null,
    user_agent: ctx?.user_agent || null,
    details: safeJson(details)
  };

  const newHash = await appendAuditEvent(event, { prevHash: prev_hash || "" });
  return { ok: true, chain_hash: newHash };
}

export async function readLastEvents(limit = 200) {
  try {
    const data = await fs.readFile(DEFAULT_FILE, "utf8");
    const lines = data.trim().split("\n").filter(Boolean);
    const sliced = lines.slice(-Math.max(1, Math.min(limit, 2000)));
    return sliced.map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}
