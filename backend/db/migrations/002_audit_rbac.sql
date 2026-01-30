BEGIN;

-- Audit log table to track actions specific to payroll engine
CREATE TABLE IF NOT EXISTS payroll_audit_log (
  id            BIGSERIAL PRIMARY KEY,
  company_id    BIGINT REFERENCES payroll_companies(id) ON DELETE CASCADE,
  actor_user_id BIGINT,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  details       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Approvals table for four-eyes control on payroll runs
CREATE TABLE IF NOT EXISTS payroll_approvals (
  id                BIGSERIAL PRIMARY KEY,
  payroll_run_id    BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  approver_user_id  BIGINT NOT NULL,
  decision          text NOT NULL CHECK (decision IN ('approved','rejected')),
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMIT;