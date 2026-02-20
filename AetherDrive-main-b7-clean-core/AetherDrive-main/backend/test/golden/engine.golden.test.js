import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import engine from '../../src/engine.js';

function readJson(rel) {
  const p = path.resolve('test', 'fixtures', rel);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

test('engine golden (FULL)', () => {
  const input = readJson('engine_input.json');
  const policy = readJson('policy_full.json');
  const expected = readJson('expected_engine_full.json');

  const now = new Date('2026-02-13T12:00:00Z');
  const actual = engine.run(input, now, policy);

  assert.deepStrictEqual(actual, expected);
});

test('engine golden (TOTALS fast path)', () => {
  const input = readJson('engine_input.json');
  const policy = readJson('policy_totals.json');
  const expected = readJson('expected_engine_totals.json');

  const now = new Date('2026-02-13T12:00:00Z');
  const actual = engine.run(input, now, policy);

  assert.deepStrictEqual(actual, expected);
});
