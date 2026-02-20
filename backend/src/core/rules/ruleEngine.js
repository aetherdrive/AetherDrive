/*
 * Payroll rule engine
 *
 * The rule engine reads rule definitions from versioned rule sets and
 * calculates derived payroll lines (e.g. employer tax, pension, etc.)
 * based on the imported input lines.
 */

import fs from "fs";
import path from "path";
import { validateRuleSet } from "./rulesetSchema.js";

/**
 * Load a rule set by version. If the file does not exist, throws.
 * @param {string} version
 * @returns {object}
 */
export function loadRuleSet(version = "v1") {
  const rulesDir = path.resolve("src", "core", "rules", "rulesets");
  const file = path.join(rulesDir, `${version}.json`);
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  validateRuleSet(parsed, { requestedVersion: version, file });
  return parsed;
}

function roundMoney(value, rounding) {
  if (!Number.isFinite(value)) return 0;
  if (rounding === "two_decimals") return Math.round(value * 100) / 100;
  // integer minor units (e.g. NOK)
  return Math.round(value);
}

function getPolicy(ruleSet) {
  return ruleSet.policy && typeof ruleSet.policy === "object" ? ruleSet.policy : {};
}

/**
 * Calculate derived lines based on inputs and a rule set.
 * @param {Array} inputs - imported line items (with line_type and amount)
 * @param {object} ruleSet - a rule definition loaded via loadRuleSet()
 * @returns {Array}
 */
export function calculateDerivedLines(inputs, ruleSet) {
  const derived = [];
  const policy = getPolicy(ruleSet);
  const rounding = policy.rounding || "integer";

  const grossTotal = inputs
    .filter((it) => it.line_type !== "withholding")
    .reduce((acc, it) => acc + (typeof it.amount === "number" ? it.amount : 0), 0);

  // Legacy support: employer tax can be specified as a single rate.
  const legacyEmployerTaxRate = ruleSet.employer_tax_rate ?? policy.employer_tax_rate;
  if (legacyEmployerTaxRate) {
    derived.push({ line_type: "employer_tax", amount: roundMoney(grossTotal * legacyEmployerTaxRate, rounding) });
  }

  // Generic derived rules (preferred)
  const rules = Array.isArray(policy.derived_rules) ? policy.derived_rules : [];
  for (const r of rules) {
    const out = r.out_line_type;
    const name = r.name || null;

    if (r.type === "percentage_of_gross") {
      derived.push({
        line_type: out,
        amount: roundMoney(grossTotal * r.rate, rounding),
        meta: { rule: name },
      });
      continue;
    }

    if (r.type === "percentage_of_gross_with_cap") {
      const base = Math.min(grossTotal, r.cap_amount);
      derived.push({
        line_type: out,
        amount: roundMoney(base * r.rate, rounding),
        meta: { rule: name, cap_amount: r.cap_amount },
      });
      continue;
    }

    if (r.type === "threshold_piecewise_percentage") {
      const below = Math.min(grossTotal, r.threshold_amount);
      const above = Math.max(0, grossTotal - r.threshold_amount);
      const amount = below * r.rate_below + above * r.rate_above;
      derived.push({
        line_type: out,
        amount: roundMoney(amount, rounding),
        meta: { rule: name, threshold_amount: r.threshold_amount },
      });
      continue;
    }

    if (r.type === "per_employee_percentage_of_gross") {
      // 80/20: apply per employee type if input lines carry meta.employee_type
      // We compute gross per employee and emit one derived line per employee.
      const byEmp = new Map();
      for (const it of inputs) {
        if (it.line_type === "withholding") continue;
        const emp = it.employee || "unknown";
        const prev = byEmp.get(emp) || { gross: 0, employee_type: it?.meta?.employee_type || null };
        prev.gross += typeof it.amount === "number" ? it.amount : 0;
        if (!prev.employee_type && it?.meta?.employee_type) prev.employee_type = it.meta.employee_type;
        byEmp.set(emp, prev);
      }
      for (const [emp, v] of byEmp.entries()) {
        const et = String(v.employee_type || "default");
        const rate = r.rate_by_employee_type?.[et] ?? r.rate_by_employee_type?.default ?? 0;
        derived.push({
          employee: emp,
          line_type: out,
          amount: roundMoney(v.gross * rate, rounding),
          meta: { rule: name, employee_type: et },
        });
      }
      continue;
    }

    // If schema validation is bypassed, fail closed here as well.
    throw new Error(`unsupported_derived_rule_type_${r.type}`);
  }

  return derived;
}

/**
 * Validate an input line against ruleset constraints (80/20).
 * @param {object} line
 * @param {object} ruleSet
 */
export function validateInputLine(line, ruleSet) {
  const policy = getPolicy(ruleSet);
  const input = policy.input_constraints && typeof policy.input_constraints === "object" ? policy.input_constraints : {};
  const allowed = Array.isArray(input.allowed_line_types) ? input.allowed_line_types : null;
  const allowNeg = new Set(Array.isArray(input.allow_negative_line_types) ? input.allow_negative_line_types : ["withholding", "adjustment"]);

  if (allowed && !allowed.includes(line.line_type)) {
    const err = new Error(`unsupported_line_type_${line.line_type}`);
    err.status = 422;
    throw err;
  }
  if (typeof line.amount !== "number" || !Number.isFinite(line.amount)) {
    const err = new Error("invalid_amount");
    err.status = 422;
    throw err;
  }
  if (line.amount < 0 && !allowNeg.has(line.line_type)) {
    const err = new Error(`negative_not_allowed_${line.line_type}`);
    err.status = 422;
    throw err;
  }
}
