import fs from "fs";
import path from "path";
import { query, hasDb } from "../db/dbClient.js";

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

export async function repoGet(id) {
  if (hasDb()) {
    const r = await query("SELECT * FROM payroll_runs WHERE id=$1", [id]);
    return r.rows[0] ? dbToRun(r.rows[0]) : null;
  }
  const runs = readFileRuns();
  return runs.find(x => x.id === id) || null;
}

export async function repoUpsert(run) {
  if (hasDb()) {
    await query(
      `INSERT INTO payroll_runs (id, company_id, period_start, period_end, pay_date, currency, rule_set_version, status, totals, inputs, derived, checksum, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         company_id=EXCLUDED.company_id,
         period_start=EXCLUDED.period_start,
         period_end=EXCLUDED.period_end,
         pay_date=EXCLUDED.pay_date,
         currency=EXCLUDED.currency,
         rule_set_version=EXCLUDED.rule_set_version,
         status=EXCLUDED.status,
         totals=EXCLUDED.totals,
         inputs=EXCLUDED.inputs,
         derived=EXCLUDED.derived,
         checksum=EXCLUDED.checksum,
         updated_at=EXCLUDED.updated_at`,
      [
        run.id,
        run.companyId,
        run.period_start,
        run.period_end,
        run.pay_date,
        run.currency,
        run.rule_set_version,
        run.status,
        jsonStr(run.totals || {}),
        jsonStr(run.inputs || []),
        jsonStr(run.derived || []),
        run.checksum,
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
    companyId: row.company_id,
    period_start: row.period_start.toISOString().slice(0,10),
    period_end: row.period_end.toISOString().slice(0,10),
    pay_date: row.pay_date.toISOString().slice(0,10),
    currency: row.currency,
    rule_set_version: row.rule_set_version,
    status: row.status,
    totals: row.totals,
    inputs: row.inputs,
    derived: row.derived,
    checksum: row.checksum,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}
