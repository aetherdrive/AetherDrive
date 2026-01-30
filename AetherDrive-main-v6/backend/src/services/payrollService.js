import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// Optional encryption key for securing payroll data at rest.
// Set PAYROLL_ENCRYPTION_KEY to a 32+ character string to enable AES-256-CTR
// encryption of the JSON payload. If the key is missing or too short,
// payroll data will be stored in plaintext. The IV is prepended to the
// ciphertext (hex encoded) separated by ':'.
const PAYROLL_KEY = process.env.PAYROLL_ENCRYPTION_KEY;
const USE_ENCRYPTION = PAYROLL_KEY && PAYROLL_KEY.length >= 32;

function encryptData(data) {
  if (!USE_ENCRYPTION) {
    return JSON.stringify(data, null, 2);
  }
  const key = Buffer.from(PAYROLL_KEY.slice(0, 32));
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-ctr', key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptData(raw) {
  if (!USE_ENCRYPTION) {
    return JSON.parse(raw);
  }
  const parts = String(raw).split(':');
  if (parts.length !== 2) {
    // fall back to plain JSON parsing if the format is unexpected
    return JSON.parse(raw);
  }
  const [ivHex, encHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const key = Buffer.from(PAYROLL_KEY.slice(0, 32));
  const decipher = crypto.createDecipheriv('aes-256-ctr', key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  return JSON.parse(decrypted);
}

// Path to the JSON file storing payroll runs. The file is in the backend/data directory
const RUNS_PATH = path.resolve('data', 'payroll_runs.json');

function ensureFile() {
  try {
    fs.accessSync(RUNS_PATH);
  } catch {
    // Ensure directory exists and create empty array file
    fs.mkdirSync(path.dirname(RUNS_PATH), { recursive: true });
    // Write an empty encrypted array to initialize the file
    const initial = encryptData([]);
    fs.writeFileSync(RUNS_PATH, initial, 'utf8');
  }
}

function loadRuns() {
  ensureFile();
  try {
    const raw = fs.readFileSync(RUNS_PATH, 'utf8');
    const data = decryptData(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveRuns(runs) {
  ensureFile();
  const serialized = encryptData(runs);
  fs.writeFileSync(RUNS_PATH, serialized, 'utf8');
}

function generateId(runs) {
  // Simple unique identifier: timestamp + count
  const ts = Date.now();
  const count = runs.length + 1;
  return `${ts}_${count}`;
}

/**
 * Compute a deterministic SHA256 checksum over the input items.
 * Inputs are first normalized (stringified with keys sorted) so that the
 * checksum is independent of property order. If no inputs are provided,
 * returns a fixed value. This checksum can be used to detect whether a
 * run's inputs have changed and to support idempotent commit operations.
 * @param {Array} items
 * @returns {string}
 */
function computeChecksum(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '0'.repeat(64);
  }
  const normalized = items
    .map((obj) => JSON.stringify(Object.keys(obj).sort().reduce((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {})))
    .join('|');
  const hash = crypto.createHash('sha256');
  hash.update(normalized);
  return hash.digest('hex');
}

export function createRun({ companyId, period_start, period_end, pay_date, currency = 'NOK', rule_set_version = 'v1' }) {
  const runs = loadRuns();
  const newRun = {
    id: generateId(runs),
    company_id: companyId,
    period_start,
    period_end,
    pay_date,
    currency,
    rule_set_version,
    status: 'draft',
    inputs: [],
    totals: null,
    checksum: null,
    created_at: new Date().toISOString(),
    committed_at: null,
    approved_by: null
  };
  runs.push(newRun);
  saveRuns(runs);
  return newRun;
}

export function addInputs(runId, inputs) {
  const runs = loadRuns();
  const run = runs.find((r) => String(r.id) === String(runId));
  if (!run) return null;
  // Inputs can only be added to a run that is not yet committed
  if (!['draft', 'calculated'].includes(run.status)) {
    return null;
  }
  run.inputs = run.inputs || [];
  const items = Array.isArray(inputs) ? inputs : [];
  for (const it of items) {
    run.inputs.push(it);
  }
  run.status = 'draft';
  saveRuns(runs);
  return run;
}

export function calculateRun(runId) {
  const runs = loadRuns();
  const run = runs.find((r) => String(r.id) === String(runId));
  if (!run) return null;
  if (!['draft', 'calculated'].includes(run.status)) {
    return null;
  }
  let gross = 0;
  let withholding = 0;
  for (const input of run.inputs) {
    const amount = typeof input.amount === 'number' ? input.amount : 0;
    if (input.line_type === 'withholding') {
      withholding += amount;
    } else {
      gross += amount;
    }
  }
  const totals = {
    gross_total: gross,
    withholding_total: withholding,
    input_count: run.inputs.length
  };
  run.totals = totals;
  run.status = 'calculated';
  saveRuns(runs);
  return { runId: run.id, totals };
}

export function approveRun(runId, approverId = null) {
  const runs = loadRuns();
  const run = runs.find((r) => String(r.id) === String(runId));
  if (!run) return null;
  // Only allow approval from a calculated run
  if (run.status !== 'calculated') {
    return null;
  }
  run.status = 'approved';
  run.approved_by = approverId;
  saveRuns(runs);
  return run;
}

export function commitRun(runId) {
  const runs = loadRuns();
  const run = runs.find((r) => String(r.id) === String(runId));
  if (!run) return null;
  // Only allow commit on an approved run
  if (run.status !== 'approved') {
    return null;
  }
  // Compute checksum of current inputs to capture immutable ledger snapshot
  const checksum = computeChecksum(run.inputs);
  run.status = 'committed';
  run.committed_at = new Date().toISOString();
  run.checksum = checksum;
  saveRuns(runs);
  return run;
}

export function reconcileRun(runId) {
  const runs = loadRuns();
  const run = runs.find((r) => String(r.id) === String(runId));
  if (!run) return null;
  const totals = run.totals || {};
  return { runId: run.id, status: run.status, totals };
}