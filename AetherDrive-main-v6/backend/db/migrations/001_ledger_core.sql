BEGIN;

-- Payroll engine core tables

CREATE TABLE IF NOT EXISTS payroll_companies (
  id            BIGSERIAL PRIMARY KEY,
  org_id        uuid,
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE payroll_run_status AS ENUM (
  'draft','calculated','approved','committed','paid','reported','reconciled','voided'
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id             BIGSERIAL PRIMARY KEY,
  company_id     BIGINT NOT NULL REFERENCES payroll_companies(id) ON DELETE CASCADE,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  pay_date       date NOT NULL,
  status         payroll_run_status NOT NULL DEFAULT 'draft',
  currency       text NOT NULL DEFAULT 'NOK',
  created_by     bigint,
  approved_by    bigint,
  committed_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, period_start, period_end, pay_date)
);

CREATE TABLE IF NOT EXISTS payroll_inputs (
  id             BIGSERIAL PRIMARY KEY,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_ref   text NOT NULL,
  input_type     text NOT NULL,
  payload        jsonb NOT NULL,
  source         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payroll_ledger_lines (
  id             BIGSERIAL PRIMARY KEY,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
  employee_ref   text NOT NULL,
  line_type      text NOT NULL,
  amount         numeric(14,2) NOT NULL,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE payment_type AS ENUM ('salary','withholding','employer_tax','other');

CREATE TABLE IF NOT EXISTS payment_instructions (
  id             BIGSERIAL PRIMARY KEY,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  payment_type   payment_type NOT NULL,
  recipient_ref  text NOT NULL,
  bank_account   text,
  amount         numeric(14,2) NOT NULL,
  kid            text,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status         text NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMIT;