import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

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
  await client.query('BEGIN');
  await client.query('ALTER TABLE aetherdrive.organizations DISABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE aetherdrive.api_keys DISABLE ROW LEVEL SECURITY');
  await client.query(
    `INSERT INTO aetherdrive.organizations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [orgId, 'Test Org']
  );
  await client.query(
    `INSERT INTO aetherdrive.api_keys (org_id, key_hash, label) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [orgId, keyHash, 'test']
  );
  await client.query('ALTER TABLE aetherdrive.organizations ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE aetherdrive.api_keys ENABLE ROW LEVEL SECURITY');
  await client.query('COMMIT');
}

async function setOrgContext(client, orgId) {
  await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
}

test('GOLDEN payroll run: committed output + checksum are stable across changes (Postgres + RLS)', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set');
    return;
  }

    const cases = [
    { caseFile: 'payroll_run_case1.json', expectedFile: 'expected_payroll_case1.json' },
    { caseFile: 'payroll_run_case2.json', expectedFile: 'expected_payroll_case2.json' },
    { caseFile: 'payroll_run_case3.json', expectedFile: 'expected_payroll_case3.json' },
  ];

  const orgId = '22222222-2222-2222-2222-222222222222';
  const apiKey = 'golden_api_key_case1';

  const client = await connectPg();
  t.after(async () => {
    await client.end();
  });

  await resetDb(client);
  await bootstrapOrgAndKey(client, { orgId, apiKey });
  await setOrgContext(client, orgId);

  const payrollSvc = await import('../../src/domain/payrollService.js');

  const ctx = { db: client, orgId, requestId: 'rid_golden', actor: 'golden_test' };

  for (const c of cases) {
    const casePath = path.resolve('test', 'fixtures', c.caseFile);
    const expectedPath = path.resolve('test', 'fixtures', c.expectedFile);
    const { run: runSpec, inputs } = readJson(casePath);
    const expected = readJson(expectedPath);

    const run = await payrollSvc.createRun(ctx, runSpec);
    await payrollSvc.addInputs(ctx, run.id, inputs);
    await payrollSvc.calculateRun(ctx, run.id);
    await payrollSvc.approveRun(ctx, run.id);
    await payrollSvc.commitRun(ctx, run.id);
    const rec = await payrollSvc.reconcileRun(ctx, run.id);

    const stable = {
      status: rec.status,
      currency: rec.currency,
      totals: rec.totals,
      checksum: rec.checksum,
      counts: rec.counts,
    };

    assert.deepStrictEqual(stable, expected);
  }
});
