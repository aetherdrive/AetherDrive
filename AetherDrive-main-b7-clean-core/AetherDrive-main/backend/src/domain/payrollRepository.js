import fs from "fs";
import path from "path";
import { hasDb } from "../infra/db/dbClient.js";

const RUNS_PATH = path.resolve("data", "payroll_runs.json");

function ensureFile() {
  try { fs.accessSync(RUNS_PATH); }
  catch {
    fs.mkdirSync(path.dirname(RUNS_PATH), { recursive: true });
    fs.writeFileSync(RUNS_PATH, "[]", "utf8");
  }
}

function readFileRuns() {
  ensureFile();
  return JSON.parse(fs.readFileSync(RUNS_PATH, "utf8") || "[]");
}

function writeFileRuns(runs) {
  ensureFile();
  fs.writeFileSync(RUNS_PATH, JSON.stringify(runs, null, 2), "utf8");
}

export async function repoGet(id, db = null) {
  if (hasDb()) {
    if (!db) throw new Error("db_client_required");
    const r = await db.query("SELECT * FROM aetherdrive.payroll_runs WHERE id=$1", [id]);
    return r.rows[0] ? dbToRun(r.rows[0]) : null;
  }
  const runs = readFileRuns();
  return runs.find(x => x.id === id) || null;
}

export async function repoUpsert(run, db = null) {
  if (hasDb()) {
    if (!db) throw new Error("db_client_required");
    await db.query(
`INSERT INTO aetherdrive.payroll_runs
  (id, org_id, parent_run_id, company_id, period_start, period_end, pay_date, currency,
   rule_set_version, policy_version, policy_hash, engine_version,
   status, totals, inputs, derived, providers, checksum, signature, signature_version,
   current_version, created_at, updated_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb,$18,$19,$20,$21,$22,$23)
 ON CONFLICT (id) DO UPDATE SET
   company_id=EXCLUDED.company_id,
   period_start=EXCLUDED.period_start,
   period_end=EXCLUDED.period_end,
   pay_date=EXCLUDED.pay_date,
   currency=EXCLUDED.currency,
   rule_set_version=EXCLUDED.rule_set_version,
   policy_version=EXCLUDED.policy_version,
   policy_hash=EXCLUDED.policy_hash,
   engine_version=EXCLUDED.engine_version,
   status=EXCLUDED.status,
   totals=EXCLUDED.totals,
   inputs=EXCLUDED.inputs,
   derived=EXCLUDED.derived,
   providers=EXCLUDED.providers,
   checksum=EXCLUDED.checksum,
   signature=EXCLUDED.signature,
   signature_version=EXCLUDED.signature_version,
   current_version=EXCLUDED.current_version,
   updated_at=EXCLUDED.updated_at`,
      [
  run.id,
  run.orgId,
  run.parent_run_id || null,
  run.companyId,
  run.period_start,
  run.period_end,
  run.pay_date,
  run.currency,
  run.rule_set_version,
  run.policy_version,
  run.policy_hash,
  run.engine_version,
  run.status,
  jsonStr(run.totals || {}),
  jsonStr(run.inputs || []),
  jsonStr(run.derived || []),
  jsonStr(run.providers || {}),
  run.checksum,
  run.signature || null,
  run.signature_version || null,
  run.current_version || 1,
  run.created_at,
  run.updated_at,
]
    );
    return run;
  }

  const runs = readFileRuns();
  const idx = runs.findIndex(x => x.id === run.id);
  if (idx >= 0) runs[idx] = run;
  else runs.push(run);
  writeFileRuns(runs);
  return run;
}

function jsonStr(v){ return JSON.stringify(v); }

function dbToRun(row) {
  return {
    id: row.id,
    orgId: row.org_id,
    parent_run_id: row.parent_run_id,
    companyId: row.company_id,
    period_start: row.period_start.toISOString().slice(0,10),
    period_end: row.period_end.toISOString().slice(0,10),
    pay_date: row.pay_date.toISOString().slice(0,10),
    currency: row.currency,
    rule_set_version: row.rule_set_version,
    policy_version: row.policy_version,
    policy_hash: row.policy_hash,
    engine_version: row.engine_version,
    status: row.status,
    totals: row.totals,
    inputs: row.inputs,
    derived: row.derived,
    providers: row.providers || {},
    checksum: row.checksum,
    signature: row.signature || null,
    signature_version: row.signature_version || null,
    current_version: row.current_version,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function repoList({ limit = 50 } = {}, db = null) {
  if (hasDb()) {
    if (!db) throw new Error("db_client_required");
    const r = await db.query(
      `SELECT * FROM aetherdrive.payroll_runs
       ORDER BY updated_at DESC
       LIMIT $1`,
      [Math.min(Number(limit) || 50, 200)]
    );
    return r.rows.map(dbToRun);
  }
  const runs = readFileRuns();
  return runs.slice().sort((a,b)=> String(b.updated_at||"").localeCompare(String(a.updated_at||""))).slice(0, Math.min(Number(limit)||50, 200));
}

export async function repoInsertVersion({ run, reason = "snapshot", requestId = null, actor = null }, db = null) {
  if (!hasDb()) return;
  if (!db) throw new Error("db_client_required");

  // Allocate next version number
  const r = await db.query(
    `SELECT COALESCE(MAX(version), 0) AS maxv
     FROM aetherdrive.payroll_run_versions
     WHERE run_id = $1`,
    [run.id]
  );
  const nextV = Number(r.rows[0]?.maxv || 0) + 1;

  await db.query(
    `INSERT INTO aetherdrive.payroll_run_versions
  (org_id, run_id, version, reason, rule_set_version, policy_version, policy_hash, engine_version,
   status, totals, inputs, derived, providers, checksum, signature, signature_version, request_id, actor)
 VALUES
  ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,$17,$18)`,
    [
      run.orgId,
      run.id,
      nextV,
      reason,
      run.rule_set_version,
      run.policy_version,
      run.policy_hash,
      run.engine_version,
      run.status,
      jsonStr(run.totals || {}),
      jsonStr(run.inputs || []),
      jsonStr(run.derived || []),
      jsonStr(run.providers || {}),
      run.checksum,
      run.signature || null,
      run.signature_version || null,
      requestId,
      actor,
    ]
  );

  run.current_version = nextV;
  return nextV;
}

export async function repoGetVersion({ runId, version }, db = null) {
  if (!hasDb()) return null;
  if (!db) throw new Error("db_client_required");
  const r = await db.query(
    `SELECT * FROM aetherdrive.payroll_run_versions
     WHERE run_id=$1 AND version=$2
     LIMIT 1`,
    [runId, Number(version)]
  );
  return r.rows[0] || null;
}

export async function repoListVersions(runId, db = null) {
  if (!hasDb()) return [];
  if (!db) throw new Error("db_client_required");
  const r = await db.query(
    `SELECT version, reason, status, checksum, created_at, request_id, actor, rule_set_version, policy_version, engine_version
     FROM aetherdrive.payroll_run_versions
     WHERE run_id=$1
     ORDER BY version DESC`,
    [runId]
  );
  return r.rows;
}

export async function repoInsertEvent({ orgId, runId, action, requestId = null, actor = null, details = {} }, db = null) {
  if (!hasDb()) return;
  if (!db) throw new Error("db_client_required");
  await db.query(
    `INSERT INTO aetherdrive.payroll_run_events (org_id, run_id, action, request_id, actor, details)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [orgId, runId, action, requestId, actor, JSON.stringify(details || {})]
  );
}
