import crypto from "crypto";
import { loadRuleSet, calculateDerivedLines } from "../rules/ruleEngine.js";
import { repoGet, repoUpsert } from "./payrollRepository.js";

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

function normalizeInputs(items) {
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
    assertMoney(amount, `amount_${idx}`);
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
  const lines = (payload?.lines || []).slice().sort((a, b) => {
    const ea = a.employee || "";
    const eb = b.employee || "";
    if (ea !== eb) return ea.localeCompare(eb);
    if (a.line_type !== b.line_type) return a.line_type.localeCompare(b.line_type);
    if (a.amount !== b.amount) return a.amount - b.amount;
    return 0;
  });
  const normalized = JSON.stringify(
    { ...payload, lines },
    Object.keys({ ...payload, lines }).sort()
  );
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function generateId() {
  const ts = Date.now();
  const salt = crypto.randomBytes(3).toString("hex");
  return `${ts}_${salt}`;
}

export async function createRun({ companyId = 1, period_start, period_end, pay_date, currency = "NOK", rule_set_version = "v1" }) {
  assertDate(period_start, "period_start");
  assertDate(period_end, "period_end");
  assertDate(pay_date, "pay_date");

  const run = {
    id: await generateId(),
    companyId: Number(companyId) || 1,
    period_start,
    period_end,
    pay_date,
    currency,
    rule_set_version,
    status: "draft",
    inputs: [],
    derived: [],
    totals: { gross_total: 0, withholding_total: 0, employer_tax_total: 0, net_payable: 0 },
    checksum: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await repoUpsert(run);
  return run;
}

export async function addInputs(runId, items) {
  const run = await repoGet(runId);
  if (!run) return null;
  if (!["draft", "calculated"].includes(run.status)) {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }
  const normalized = normalizeInputs(items);
  run.inputs = [...(run.inputs || []), ...normalized];
  run.derived = [];
  run.totals = { gross_total: 0, withholding_total: 0, employer_tax_total: 0, net_payable: 0 };
  run.status = "draft";
  run.updated_at = new Date().toISOString();
  await repoUpsert(run);
  return run;
}

export async function calculateRun(runId) {
  const run = await repoGet(runId);
  if (!run) return null;
  if (!["draft", "calculated"].includes(run.status)) {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }

  const inputs = Array.isArray(run.inputs) ? run.inputs : [];
  let gross = 0, withholding = 0;
  for (const line of inputs) {
    if (line.line_type === "withholding") withholding += Number(line.amount) || 0;
    else gross += Number(line.amount) || 0;
  }

  const rules = loadRuleSet(run.rule_set_version || "v1");
  const derived = calculateDerivedLines(inputs, rules) || [];
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
  run.status = "calculated";
  run.updated_at = new Date().toISOString();
  await repoUpsert(run);
  return run;
}

export async function approveRun(runId) {
  const run = await repoGet(runId);
  if (!run) return null;
  if (run.status !== "calculated") {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }
  run.status = "approved";
  run.updated_at = new Date().toISOString();
  await repoUpsert(run);
  return run;
}

export async function commitRun(runId) {
  const run = await repoGet(runId);
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
  run.updated_at = new Date().toISOString();
  await repoUpsert(run);
  return run;
}

export async function reconcileRun(runId) {
  const run = await repoGet(runId);
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
