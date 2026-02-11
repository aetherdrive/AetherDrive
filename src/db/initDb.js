import { query, hasDb } from "./dbClient.js";

if (!hasDb()) {
  console.error("DATABASE_URL not set. Cannot init DB.");
  process.exit(1);
}

const sql = `
CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  company_id INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  pay_date DATE NOT NULL,
  currency TEXT NOT NULL DEFAULT 'NOK',
  rule_set_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL,
  totals JSONB NOT NULL,
  inputs JSONB NOT NULL,
  derived JSONB NOT NULL,
  checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payroll_runs_company_id_idx ON payroll_runs(company_id);
CREATE INDEX IF NOT EXISTS payroll_runs_status_idx ON payroll_runs(status);
`;

await query(sql);
console.log("DB initialized: payroll_runs table ready.");
process.exit(0);
