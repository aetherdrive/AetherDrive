-- AetherDrive Engine Schema + RLS (PostgreSQL)
-- File: backend/db/schema.sql
-- Purpose:
-- 1) Event Store (time_events) with idempotency per org
-- 2) Import runs (import_runs) for dashboard status
-- 3) Review queue (reviews) for anomalies
-- 4) Multi-tenant isolation via RLS (org_id uuid)
-- 5) Stripe-style API keys that resolve to org_id

BEGIN;

-- -------------------------------------------------------------------
-- Core schema + extensions
-- -------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS aetherdrive;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -------------------------------------------------------------------
-- Organizations (tenants)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aetherdrive.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -------------------------------------------------------------------
-- API Keys (map key -> org_id)
-- Store only hashes, never plaintext keys.
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aetherdrive.api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES aetherdrive.organizations(id) ON DELETE CASCADE,

  -- Hash of the API key (sha256 hex recommended)
  key_hash    text NOT NULL UNIQUE,

  -- Optional metadata/controls
  label       text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS ix_api_keys_org_active
  ON aetherdrive.api_keys (org_id, is_active);

-- -------------------------------------------------------------------
-- 1) EVENT STORE (immutable-ish ledger)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aetherdrive.time_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES aetherdrive.organizations(id) ON DELETE CASCADE,

  source       text NOT NULL,
  external_id  text NOT NULL, -- stable per source; used for idempotency

  employee_ref text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  type         text NOT NULL CHECK (type IN ('IN','OUT','BREAK_START','BREAK_END')),

  device_id    text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,

  received_at  timestamptz NOT NULL DEFAULT now()
);

-- Stripe-style idempotency (per org)
CREATE UNIQUE INDEX IF NOT EXISTS ux_time_events_org_source_external
  ON aetherdrive.time_events (org_id, source, external_id);

-- Performance indexes
CREATE INDEX IF NOT EXISTS ix_time_events_org_employee_time
  ON aetherdrive.time_events (org_id, employee_ref, occurred_at);

CREATE INDEX IF NOT EXISTS ix_time_events_org_occurred_at
  ON aetherdrive.time_events (org_id, occurred_at);

-- -------------------------------------------------------------------
-- 2) IMPORT RUNS (for dashboard import status)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aetherdrive.import_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES aetherdrive.organizations(id) ON DELETE CASCADE,

  source      text NOT NULL,
  request_id  text,

  accepted    integer NOT NULL DEFAULT 0 CHECK (accepted >= 0),
  duplicates  integer NOT NULL DEFAULT 0 CHECK (duplicates >= 0),
  rejected    integer NOT NULL DEFAULT 0 CHECK (rejected >= 0),

  received_at timestamptz NOT NULL DEFAULT now(),
  notes       text
);

CREATE INDEX IF NOT EXISTS ix_import_runs_org_received_at
  ON aetherdrive.import_runs (org_id, received_at DESC);

-- -------------------------------------------------------------------
-- 3) REVIEW QUEUE (robust ops)
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aetherdrive.reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES aetherdrive.organizations(id) ON DELETE CASCADE,

  employee_ref   text NOT NULL,
  day            date,           -- optional (UTC day or policy day)
  range_from     timestamptz,
  range_to       timestamptz,

  type           text NOT NULL,  -- e.g. MISSING_OUT, OUT_WITHOUT_IN, DOUBLE_IN, DUPLICATE_OUT
  severity       text NOT NULL DEFAULT 'WARN' CHECK (severity IN ('INFO','WARN','ERROR')),

  status         text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','IGNORED')),

  details        jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,
  resolved_by    text,
  resolution_note text
);

CREATE INDEX IF NOT EXISTS ix_reviews_org_status_created
  ON aetherdrive.reviews (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_reviews_org_employee_day
  ON aetherdrive.reviews (org_id, employee_ref, day);

-- -------------------------------------------------------------------
-- RLS (Row Level Security)
-- Strategy: app sets session var app.org_id for each request/transaction.
-- Example:
--   SELECT set_config('app.org_id', '<org_uuid>', true);
-- Policies enforce org_id match.
-- -------------------------------------------------------------------

ALTER TABLE aetherdrive.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.api_keys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.time_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.import_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.reviews        ENABLE ROW LEVEL SECURITY;

ALTER TABLE aetherdrive.organizations FORCE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.api_keys       FORCE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.time_events    FORCE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.import_runs    FORCE ROW LEVEL SECURITY;
ALTER TABLE aetherdrive.reviews        FORCE ROW LEVEL SECURITY;

-- Drop existing policies if re-running
DROP POLICY IF EXISTS organizations_isolation ON aetherdrive.organizations;
DROP POLICY IF EXISTS api_keys_isolation      ON aetherdrive.api_keys;
DROP POLICY IF EXISTS time_events_isolation   ON aetherdrive.time_events;
DROP POLICY IF EXISTS import_runs_isolation   ON aetherdrive.import_runs;
DROP POLICY IF EXISTS reviews_isolation       ON aetherdrive.reviews;

-- organizations: visible only if org_id matches
CREATE POLICY organizations_isolation
  ON aetherdrive.organizations
  USING (id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (id = current_setting('app.org_id', true)::uuid);

-- api_keys: only keys belonging to current org
CREATE POLICY api_keys_isolation
  ON aetherdrive.api_keys
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

-- time_events: only events belonging to current org
CREATE POLICY time_events_isolation
  ON aetherdrive.time_events
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

-- import_runs: only runs belonging to current org
CREATE POLICY import_runs_isolation
  ON aetherdrive.import_runs
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

-- reviews: only reviews belonging to current org
CREATE POLICY reviews_isolation
  ON aetherdrive.reviews
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

COMMIT;

-- -------------------------------------------------------------------
-- Notes / Next steps
-- -------------------------------------------------------------------
-- 1) You need one bootstrap org row + one api_keys row to start.
--    Because RLS is enabled, do the bootstrap as the DB owner with RLS temporarily off:
--
--    BEGIN;
--    ALTER TABLE aetherdrive.organizations DISABLE ROW LEVEL SECURITY;
--    ALTER TABLE aetherdrive.api_keys DISABLE ROW LEVEL SECURITY;
--    INSERT INTO aetherdrive.organizations (id, name) VALUES ('<ORG_UUID>', 'Demo Org');
--    INSERT INTO aetherdrive.api_keys (org_id, key_hash, label) VALUES ('<ORG_UUID>', '<SHA256_HEX_OF_KEY>', 'demo');
--    ALTER TABLE aetherdrive.organizations ENABLE ROW LEVEL SECURITY;
--    ALTER TABLE aetherdrive.api_keys ENABLE ROW LEVEL SECURITY;
--    COMMIT;
--
-- 2) In your backend, for each request:
--    - Resolve API key -> org_id (using a privileged connection OR temporarily disable RLS on api_keys lookup)
--    - Then set_config('app.org_id', org_id, true)
--    - Then run normal queries; RLS isolates data.