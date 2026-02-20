BEGIN;

-- Idempotency keys to handle safe retries for payroll API calls
CREATE TABLE IF NOT EXISTS payroll_idempotency_keys (
  key            text PRIMARY KEY,
  company_id     BIGINT NOT NULL REFERENCES payroll_companies(id) ON DELETE CASCADE,
  endpoint       text NOT NULL,
  request_hash   text NOT NULL,
  response_body  jsonb,
  status_code    int,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Report submissions table for storing payload hashes and receipts from external reporting
CREATE TABLE IF NOT EXISTS payroll_report_submissions (
  id             BIGSERIAL PRIMARY KEY,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  report_type    text NOT NULL,
  payload_hash   text NOT NULL,
  receipt        jsonb,
  status         text NOT NULL DEFAULT 'pending',
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMIT;