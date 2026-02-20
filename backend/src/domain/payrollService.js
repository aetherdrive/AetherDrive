import crypto from "crypto";
import { loadRuleSet, calculateDerivedLines, validateInputLine } from "../core/rules/ruleEngine.js";
import { resolveTaxProvider } from "./providerRegistry.js";
import { repoGet, repoUpsert, repoInsertVersion, repoInsertEvent } from "./payrollRepository.js";
import { signRun } from "../core/signing/signingService.js";

function getEngineVersion() {
  return process.env.ENGINE_VERSION || process.env.npm_package_version || "dev";
}

function assertDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const err = new Error(`invalid_${field}`);
    err.status = 422;
    throw err;
  }
}

function assertMoney(n, field) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    const err = new Error(`invalid_${field}`);
    err.status = 422;
    throw err;
  }
}

function normalizeInputs(items, ruleSet) {
  if (!Array.isArray(items) || items.length === 0) {
    const err = new Error("invalid_items");
    err.status = 422;
    throw err;
  }
  return items.map((it, idx) => {
    if (!it || typeof it !== "object") {
      const err = new Error(`invalid_item_${idx}`);
      err.status = 422;
      throw err;
    }
    const line_type = String(it.line_type || "").trim();
    if (!line_type) {
      const err = new Error(`missing_line_type_${idx}`);
      err.status = 422;
      throw err;
    }

    const amount = Number(it.amount);
    // Validate against ruleset constraints (line types + negative handling).
    validateInputLine({ line_type, amount }, ruleSet);

    return {
      employee: it.employee ? String(it.employee) : null,
      line_type,
      amount,
      meta: it.meta && typeof it.meta === "object" ? it.meta : null,
      created_at: new Date().toISOString(),
    };
  });
}

function computeChecksum(payload) {
  // IMPORTANT: Checksums must be deterministic across replays.
  // Exclude volatile fields like created_at/updated_at/request metadata.
  const stableLines = (payload?.lines || []).map((l) => ({
    employee: l?.employee ?? null,
    line_type: String(l?.line_type ?? ""),
    amount: Number(l?.amount ?? 0),
    meta: l?.meta ?? null,
  })).sort((a, b) => {
    const ea = a.employee || "";
    const eb = b.employee || "";
    if (ea !== eb) return ea.localeCompare(eb);
    if (a.line_type !== b.line_type) return a.line_type.localeCompare(b.line_type);
    if (a.amount !== b.amount) return a.amount - b.amount;
    return 0;
  });

  const normalizedPayload = {
    companyId: payload?.companyId ?? null,
    period_start: payload?.period_start ?? null,
    period_end: payload?.period_end ?? null,
    pay_date: payload?.pay_date ?? null,
    currency: payload?.currency ?? null,
    rule_set_version: payload?.rule_set_version ?? null,
    totals: payload?.totals ?? {},
    providers: payload?.providers ?? {},
    lines: stableLines,
  };

  const normalized = JSON.stringify(normalizedPayload);
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function generateId() {
  const ts = Date.now();
  const salt = crypto.randomBytes(3).toString("hex");
  return `${ts}_${salt}`;
}

export async function createRun(ctx, { companyId = 1, period_start, period_end, pay_date, currency = "NOK", rule_set_version = "v1", policy_version = null, policy_hash = null } = {}) {
  assertDate(period_start, "period_start");
  assertDate(period_end, "period_end");
  assertDate(pay_date, "pay_date");

  const run = {
    id: await generateId(),
    orgId: ctx?.orgId ?? null,
    companyId: Number(companyId) || 1,
    period_start,
    period_end,
    pay_date,
    currency,
    rule_set_version,
    policy_version: policy_version || rule_set_version || "v1",
    policy_hash: policy_hash || null,
    engine_version: getEngineVersion(),
    status: "draft",
    inputs: [],
    derived: [],
    totals: { gross_total: 0, withholding_total: 0, employer_tax_total: 0, net_payable: 0 },
    providers: {},
    checksum: null,
    signature: null,
    signature_version: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await repoUpsert(run, ctx?.db || null);

  // Initial snapshot + audit
  await repoInsertVersion({ run, reason: "created", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  await repoUpsert(run, ctx?.db || null);
  await repoInsertEvent({ orgId: run.orgId, runId: run.id, action: "created", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  return run;
}

export async function addInputs(ctx, runId, items) {
  const run = await repoGet(runId, ctx?.db || null);
  if (!run) return null;
  if (!["draft", "calculated"].includes(run.status)) {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }
  const ruleSet = loadRuleSet(run.rule_set_version || "v1");
  const normalized = normalizeInputs(items, ruleSet);
  run.inputs = [...(run.inputs || []), ...normalized];
  run.derived = [];
  run.totals = { gross_total: 0, withholding_total: 0, employer_tax_total: 0, net_payable: 0 };
  run.status = "draft";
  run.updated_at = new Date().toISOString();
  await repoInsertVersion({ run, reason: "inputs_added", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  await repoUpsert(run, ctx?.db || null);
  await repoInsertEvent({ orgId: run.orgId, runId: run.id, action: "inputs_added", requestId: ctx?.requestId || null, actor: ctx?.actor || null, details: { count: normalized.length } }, ctx?.db || null);
  return run;
}

export async function calculateRun(ctx, runId) {
  const run = await repoGet(runId, ctx?.db || null);
  if (!run) return null;
  if (!["draft", "calculated"].includes(run.status)) {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }

  const inputs = Array.isArray(run.inputs) ? run.inputs : [];
  let gross = 0, withholdingInput = 0;
  for (const line of inputs) {
    if (line.line_type === "withholding") withholdingInput += Number(line.amount) || 0;
    else gross += Number(line.amount) || 0;
  }

  const rules = loadRuleSet(run.rule_set_version || "v1");

  // Embedded mode: if withholding is not provided as an input line,
  // derive it deterministically via the configured TaxProvider.
  let withholding = withholdingInput;
  let taxDecision = null;
  if (withholdingInput === 0) {
    const taxProvider = resolveTaxProvider(ctx?.capabilities || {}, rules);
    taxDecision = await taxProvider.calculate({ run, gross, currency: run.currency });
    withholding = Number(taxDecision?.withholding_amount ?? 0) || 0;
  }
  const derived = calculateDerivedLines(inputs, rules) || [];
  // Add derived withholding line when tax provider is used.
  if (taxDecision && withholding > 0) {
    derived.push({
      employee: null,
      line_type: "withholding",
      amount: Math.round(withholding),
      meta: { provider: taxDecision.provider, version: taxDecision.version, basis: taxDecision.basis || null },
    });
  }
  let employerTax = 0;
  for (const d of derived) if (d.line_type === "employer_tax") employerTax += Number(d.amount) || 0;

  const net = gross - withholding;

  run.derived = derived.map((d) => ({
    employee: d.employee ?? null,
    line_type: String(d.line_type),
    amount: Number(d.amount),
    meta: d.meta ?? null,
    created_at: new Date().toISOString(),
  }));

  run.totals = {
    gross_total: Math.round(gross),
    withholding_total: Math.round(withholding),
    employer_tax_total: Math.round(employerTax),
    net_payable: Math.round(net),
  };
  // Snapshot provider decisions for replay/diff.
  if (taxDecision) {
    run.providers = run.providers || {};
    run.providers.tax = {
      provider: taxDecision.provider,
      version: taxDecision.version,
      basis: taxDecision.basis || null,
      withholding_amount: Math.round(withholding),
    };
  }

  run.status = "calculated";
  run.updated_at = new Date().toISOString();
  await repoInsertVersion({ run, reason: "calculated", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  await repoUpsert(run, ctx?.db || null);
  await repoInsertEvent({ orgId: run.orgId, runId: run.id, action: "calculated", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  return run;
}

export async function approveRun(ctx, runId) {
  const run = await repoGet(runId, ctx?.db || null);
  if (!run) return null;
  if (run.status !== "calculated") {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }
  run.status = "approved";
  run.updated_at = new Date().toISOString();
  await repoInsertVersion({ run, reason: "approved", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  await repoUpsert(run, ctx?.db || null);
  await repoInsertEvent({ orgId: run.orgId, runId: run.id, action: "approved", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  return run;
}

export async function commitRun(ctx, runId) {
  const run = await repoGet(runId, ctx?.db || null);
  if (!run) return null;
  if (run.status !== "approved") {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }

  const payload = {
    companyId: run.companyId,
    period_start: run.period_start,
    period_end: run.period_end,
    pay_date: run.pay_date,
    currency: run.currency,
    rule_set_version: run.rule_set_version,
    totals: run.totals,
    lines: [...(run.inputs || []), ...(run.derived || [])],
  };

  run.checksum = computeChecksum(payload);
  run.status = "committed";

  // Cryptographic receipt (tamper-evident): sign stable run payload on commit.
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  if (process.env.SIGNING_KEY_CURRENT) {
    const signed = signRun(run);
    run.signature = signed.signature;
    run.signature_version = signed.signature_version;
  } else if (isProd) {
    const err = new Error("signing_key_missing");
    err.status = 500;
    throw err;
  }

  run.updated_at = new Date().toISOString();
  await repoInsertVersion({ run, reason: "committed", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  await repoUpsert(run, ctx?.db || null);
  await repoInsertEvent({ orgId: run.orgId, runId: run.id, action: "committed", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  return run;
}

export async function reconcileRun(ctx, runId) {
  const run = await repoGet(runId, ctx?.db || null);
  if (!run) return null;
  const lines = [...(run.inputs || []), ...(run.derived || [])];
  return {
    id: run.id,
    companyId: run.companyId,
    period_start: run.period_start,
    period_end: run.period_end,
    pay_date: run.pay_date,
    currency: run.currency,
    status: run.status,
    totals: run.totals,
    checksum: run.checksum,
    counts: { inputs: (run.inputs || []).length, derived: (run.derived || []).length, total_lines: lines.length },
    updated_at: run.updated_at,
  };
}

/**
 * Create a new run by forking an existing one.
 * This is the safe path for B2B embedded payroll: committed runs stay immutable.
 */
export async function forkRun(ctx, parentRunId, { rule_set_version = null, policy_version = null, policy_hash = null } = {}) {
  const parent = await repoGet(parentRunId, ctx?.db || null);
  if (!parent) return null;

  const run = {
    id: await generateId(),
    orgId: parent.orgId,
    parent_run_id: parent.id,
    companyId: parent.companyId,
    period_start: parent.period_start,
    period_end: parent.period_end,
    pay_date: parent.pay_date,
    currency: parent.currency,
    rule_set_version: rule_set_version || parent.rule_set_version,
    policy_version: policy_version || rule_set_version || parent.policy_version,
    policy_hash: policy_hash || parent.policy_hash || null,
    engine_version: getEngineVersion(),
    status: "draft",
    inputs: Array.isArray(parent.inputs) ? parent.inputs : [],
    derived: [],
    totals: { gross_total: 0, withholding_total: 0, employer_tax_total: 0, net_payable: 0 },
    providers: {},
    checksum: null,
    signature: null,
    signature_version: null,
    current_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await repoUpsert(run, ctx?.db || null);
  await repoInsertVersion({ run, reason: "forked", requestId: ctx?.requestId || null, actor: ctx?.actor || null }, ctx?.db || null);
  await repoUpsert(run, ctx?.db || null);
  await repoInsertEvent({ orgId: run.orgId, runId: run.id, action: "forked", requestId: ctx?.requestId || null, actor: ctx?.actor || null, details: { parentRunId: parent.id } }, ctx?.db || null);
  return run;
}