import fs from "fs";
import path from "path";
import crypto from "crypto";
import { loadRuleSet, calculateDerivedLines } from "../rules/ruleEngine.js";

const RUNS_PATH = path.resolve("data", "payroll_runs.json");

/**
 * Optional encryption for at-rest storage.
 * If PAYROLL_ENCRYPTION_KEY is set (>=32 chars), the JSON payload is encrypted
 * with AES-256-CTR. This is a pragmatic protection for file-based storage.
 */
const ENC_KEY_RAW = process.env.PAYROLL_ENCRYPTION_KEY || null;
const ENC_KEY =
  ENC_KEY_RAW && ENC_KEY_RAW.length >= 32
    ? crypto.createHash("sha256").update(ENC_KEY_RAW).digest()
    : null;

function encryptData(obj) {
  const json = JSON.stringify(obj);
  if (!ENC_KEY) return json;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-ctr", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(json, "utf8")), cipher.final()]);
  // store as iv:hex + ":" + payload:hex
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

function decryptData(str) {
  if (!ENC_KEY) return JSON.parse(str || "[]");
  const [ivHex, payloadHex] = String(str).split(":");
  if (!ivHex || !payloadHex) return JSON.parse(str || "[]");
  const iv = Buffer.from(ivHex, "hex");
  const payload = Buffer.from(payloadHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-ctr", ENC_KEY, iv);
  const dec = Buffer.concat([decipher.update(payload), decipher.final()]);
  return JSON.parse(dec.toString("utf8") || "[]");
}

function ensureFile() {
  try {
    fs.accessSync(RUNS_PATH);
  } catch {
    fs.mkdirSync(path.dirname(RUNS_PATH), { recursive: true });
    fs.writeFileSync(RUNS_PATH, encryptData([]), "utf8");
  }
}

function readRuns() {
  ensureFile();
  const raw = fs.readFileSync(RUNS_PATH, "utf8") || "[]";
  return decryptData(raw);
}

function writeRuns(runs) {
  ensureFile();
  fs.writeFileSync(RUNS_PATH, encryptData(runs), "utf8");
}

function generateId(runs) {
  const ts = Date.now();
  const count = runs.length + 1;
  return `${ts}_${count}`;
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
    const employee = it.employee ? String(it.employee) : null;
    const meta = it.meta && typeof it.meta === "object" ? it.meta : null;
    return {
      employee,
      line_type,
      amount,
      meta,
      created_at: new Date().toISOString(),
    };
  });
}

function computeChecksum(payload) {
  // Deterministic checksum for audit/replay: sort lines by (employee,line_type,amount)
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

function findRun(runs, runId) {
  return runs.find((r) => r.id === runId);
}

export function createRun({ companyId = 1, period_start, period_end, pay_date, currency = "NOK", rule_set_version = "v1" }) {
  assertDate(period_start, "period_start");
  assertDate(period_end, "period_end");
  assertDate(pay_date, "pay_date");

  const runs = readRuns();
  const run = {
    id: generateId(runs),
    companyId: Number(companyId) || 1,
    period_start,
    period_end,
    pay_date,
    currency,
    rule_set_version,
    status: "draft",
    inputs: [],
    derived: [],
    totals: {
      gross_total: 0,
      withholding_total: 0,
      employer_tax_total: 0,
      net_payable: 0,
    },
    checksum: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  runs.push(run);
  writeRuns(runs);
  return run;
}

export function addInputs(runId, items) {
  const runs = readRuns();
  const run = findRun(runs, runId);
  if (!run) return null;

  if (!["draft", "calculated"].includes(run.status)) {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }

  const normalized = normalizeInputs(items);
  run.inputs = [...(run.inputs || []), ...normalized];
  run.updated_at = new Date().toISOString();
  // adding inputs invalidates derived/totals and moves back to draft
  run.derived = [];
  run.totals = { gross_total: 0, withholding_total: 0, employer_tax_total: 0, net_payable: 0 };
  run.status = "draft";
  writeRuns(runs);
  return run;
}

export function calculateRun(runId) {
  const runs = readRuns();
  const run = findRun(runs, runId);
  if (!run) return null;

  if (!["draft", "calculated"].includes(run.status)) {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }

  const inputs = Array.isArray(run.inputs) ? run.inputs : [];

  // Totals from inputs
  let gross = 0;
  let withholding = 0;
  for (const line of inputs) {
    if (line.line_type === "withholding") withholding += Number(line.amount) || 0;
    else gross += Number(line.amount) || 0;
  }

  // Derived lines via rule engine
  const rules = loadRuleSet(run.rule_set_version || "v1");
  const derived = calculateDerivedLines({ grossTotal: gross, rules }) || [];

  let employerTax = 0;
  for (const d of derived) {
    if (d.line_type === "employer_tax") employerTax += Number(d.amount) || 0;
  }

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
  writeRuns(runs);
  return run;
}

export function approveRun(runId) {
  const runs = readRuns();
  const run = findRun(runs, runId);
  if (!run) return null;

  if (run.status !== "calculated") {
    const err = new Error("invalid_operation");
    err.status = 409;
    throw err;
  }

  run.status = "approved";
  run.updated_at = new Date().toISOString();
  writeRuns(runs);
  return run;
}

export function commitRun(runId) {
  const runs = readRuns();
  const run = findRun(runs, runId);
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
  writeRuns(runs);
  return run;
}

export function reconcileRun(runId) {
  const runs = readRuns();
  const run = findRun(runs, runId);
  if (!run) return null;

  // Allow reconciliation at any stage, but show status.
  const lines = [...(run.inputs || []), ...(run.derived || [])];
  const breakdown = {
    gross_lines: lines.filter((l) => l.line_type !== "withholding" && l.line_type !== "employer_tax"),
    withholding_lines: lines.filter((l) => l.line_type === "withholding"),
    employer_tax_lines: lines.filter((l) => l.line_type === "employer_tax"),
  };

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
    counts: {
      inputs: (run.inputs || []).length,
      derived: (run.derived || []).length,
      total_lines: lines.length,
    },
    breakdown_summary: {
      gross_total: run.totals?.gross_total ?? 0,
      withholding_total: run.totals?.withholding_total ?? 0,
      employer_tax_total: run.totals?.employer_tax_total ?? 0,
      net_payable: run.totals?.net_payable ?? 0,
    },
    updated_at: run.updated_at,
  };
}
