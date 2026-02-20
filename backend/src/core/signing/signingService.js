import crypto from "crypto";

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

export function getSigningConfig() {
  const current = process.env.SIGNING_KEY_CURRENT || "";
  const previous = process.env.SIGNING_KEY_PREVIOUS || "";
  const version = Number(process.env.SIGNING_KEY_VERSION || 1);
  return { current, previous, version };
}

export function buildRunSignaturePayload(run) {
  return {
    org_id: run.orgId,
    run_id: run.id,
    parent_run_id: run.parent_run_id || null,
    company_id: run.companyId,
    period_start: run.period_start,
    period_end: run.period_end,
    pay_date: run.pay_date,
    currency: run.currency,
    rule_set_version: run.rule_set_version,
    policy_version: run.policy_version,
    policy_hash: run.policy_hash || null,
    engine_version: run.engine_version || null,
    status: run.status,
    totals: run.totals || {},
    providers: run.providers || {},
    checksum: run.checksum || null,
  };
}

export function signPayloadHex(payload, key) {
  const msg = stableStringify(payload);
  return crypto.createHmac("sha256", key).update(msg).digest("hex");
}

export function signRun(run) {
  const { current, version } = getSigningConfig();
  if (!current) {
    const err = new Error("signing_key_missing");
    err.status = 500;
    throw err;
  }
  const payload = buildRunSignaturePayload(run);
  const sig = signPayloadHex(payload, current);
  return { signature: sig, signature_version: version };
}

export function verifyRun(run) {
  const { current, previous, version } = getSigningConfig();
  if (!run?.signature) return { valid: false, key_version: null, reason: "unsigned" };
  const payload = buildRunSignaturePayload(run);

  if (current) {
    const sig = signPayloadHex(payload, current);
    if (sig === run.signature) return { valid: true, key_version: version };
  }
  if (previous) {
    const sigPrev = signPayloadHex(payload, previous);
    if (sigPrev === run.signature) return { valid: true, key_version: "previous" };
  }
  return { valid: false, key_version: null, reason: "mismatch" };
}
