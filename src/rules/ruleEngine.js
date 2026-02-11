/*
 * Payroll rule engine
 *
 * The rule engine reads rule definitions from versioned rule sets and
 * calculates derived payroll lines (e.g. employer tax, pension, etc.)
 * based on the imported input lines. A rule set can be updated without
 * modifying core business logic. See `rulesets/v1.json` for an example
 * definition. Real implementations would support multiple rates per
 * employee type, caps, thresholds, and other country‑specific rules.
 */

import fs from 'fs';
import path from 'path';

/**
 * Load a rule set by version. If the file does not exist, throws.
 * @param {string} version
 * @returns {object}
 */
export function loadRuleSet(version = 'v1') {
  const rulesDir = path.resolve('src', 'rules', 'rulesets');
  const file = path.join(rulesDir, `${version}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw);
}

/**
 * Calculate derived lines (employer tax, etc.) based on inputs and a rule set.
 * @param {Array} inputs - imported line items (with line_type and amount)
 * @param {object} ruleSet - a rule definition loaded via loadRuleSet()
 * @returns {Array}
 */
export function calculateDerivedLines(inputs, ruleSet) {
  const derived = [];
  // Simple example: employer tax as a percentage of gross salary
  const grossTotal = inputs
    .filter((it) => it.line_type !== 'withholding')
    .reduce((acc, it) => acc + (typeof it.amount === 'number' ? it.amount : 0), 0);
  if (ruleSet.employer_tax_rate) {
    derived.push({ line_type: 'employer_tax', amount: grossTotal * ruleSet.employer_tax_rate });
  }
  return derived;
}