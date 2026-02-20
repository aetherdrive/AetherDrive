import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function readSchemaSql() {
  const p = path.resolve('db', 'schema.sql');
  return fs.readFileSync(p, 'utf8');
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function connectPg() {
  const { Client } = await import('pg');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set for integration test');
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function resetDb(client) {
  await client.query('DROP SCHEMA IF EXISTS aetherdrive CASCADE');
  await client.query(readSchemaSql());
}

async function bootstrapOrgAndKey(client, { orgId, apiKey }) {
  const keyHash = sha256Hex(apiKey);
  // Bootstrap inserts need RLS disabled on orgs + api_keys
  await client.query('BEGIN');
  await client.query('ALTER TABLE aetherdrive.organizations DISABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE aetherdrive.api_keys DISABLE ROW LEVEL SECURITY');
  await client.query(`INSERT INTO aetherdrive.organizations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [orgId, 'Test Org']);
  await client.query(
    `INSERT INTO aetherdrive.api_keys (org_id, key_hash, label) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [orgId, keyHash, 'test']
  );
  await client.query('ALTER TABLE aetherdrive.organizations ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE aetherdrive.api_keys ENABLE ROW LEVEL SECURITY');
  await client.query('COMMIT');
  return { keyHash };
}

async function setOrgContext(client, orgId) {
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
}

test('payroll run lifecycle is deterministic and versioned (Postgres + RLS)', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set');
    return;
  }

  const orgId = '11111111-1111-1111-1111-111111111111';
  const apiKey = 'test_api_key_123';

  const client = await connectPg();
  t.after(async () => {
    await client.end();
  });

  await resetDb(client);
  await bootstrapOrgAndKey(client, { orgId, apiKey });
  await setOrgContext(client, orgId);

  // Import after DATABASE_URL is set so hasDb() is true
  const payrollSvc = await import('../../src/domain/payrollService.js');
  const repo = await import('../../src/domain/payrollRepository.js');

  const ctx = { db: client, orgId, requestId: 'rid_test', actor: 'test_user' };

  const run = await payrollSvc.createRun(ctx, {
    companyId: 1,
    period_start: '2026-01-01',
    period_end: '2026-01-31',
    pay_date: '2026-02-05',
    currency: 'NOK',
    rule_set_version: 'v1'
  });

  assert.equal(run.status, 'draft');
  assert.equal(run.orgId, orgId);
  assert.equal(run.current_version, 1);

  const withInputs = await payrollSvc.addInputs(ctx, run.id, [
    { employee: 'E1', line_type: 'wage', amount: 1000 },
    { employee: 'E1', line_type: 'withholding', amount: 200 }
  ]);
  assert.equal(withInputs.current_version, 2);

  const calculated = await payrollSvc.calculateRun(ctx, run.id);
  assert.equal(calculated.status, 'calculated');
  assert.equal(calculated.totals.gross_total, 1000);
  assert.equal(calculated.totals.withholding_total, 200);
  assert.equal(calculated.totals.employer_tax_total, 141);
  assert.equal(calculated.totals.net_payable, 800);
  assert.equal(calculated.current_version, 3);

  const approved = await payrollSvc.approveRun(ctx, run.id);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.current_version, 4);

  const committed = await payrollSvc.commitRun(ctx, run.id);
  assert.equal(committed.status, 'committed');
  assert.ok(typeof committed.checksum === 'string' && committed.checksum.length === 64);
  assert.equal(committed.current_version, 5);

  // Version history exists and is append-only
  const versions = await repo.repoListVersions(run.id, client);
  assert.equal(versions.length, 5);

  const v4 = await repo.repoGetVersion({ runId: run.id, version: 4 }, client);
  const v5 = await repo.repoGetVersion({ runId: run.id, version: 5 }, client);
  assert.equal(v4.status, 'approved');
  assert.equal(v5.status, 'committed');

  // Totals unchanged by commit (checksum added + status change)
  assert.deepStrictEqual(v4.totals, v5.totals);

  // Fork + recompute should create a new run with parent_run_id
  const forked = await payrollSvc.forkRun(ctx, run.id, { rule_set_version: 'v1' });
  assert.equal(forked.parent_run_id, run.id);
  assert.equal(forked.status, 'draft');

  const forkCalculated = await payrollSvc.calculateRun(ctx, forked.id);
  assert.equal(forkCalculated.status, 'calculated');
  assert.equal(forkCalculated.totals.net_payable, 800);

  const forkVersions = await repo.repoListVersions(forked.id, client);
  assert.ok(forkVersions.length >= 2); // created + forked + calculated (at least)
});
