/**
 * Minimal ruleset schema validation (80/20).
 *
 * We avoid heavy dependencies (Ajv/Zod) to keep the runtime surface small,
 * but still enforce the contract that makes payroll runs deterministic.
 */

export function validateRuleSet(ruleSet, { requestedVersion = null, file = null } = {}) {
  if (!ruleSet || typeof ruleSet !== "object") throw new Error("invalid_ruleset");

  const version = String(ruleSet.version || "").trim();
  if (!version) throw new Error("missing_ruleset_version");
  if (requestedVersion && version !== requestedVersion) {
    // Not fatal, but a strong signal: you asked for v2 and loaded v1.json.
    console.warn(`ruleset_version_mismatch: requested=${requestedVersion} loaded=${version} file=${file || ""}`.trim());
  }

  const currency = String(ruleSet.currency || "").trim();
  if (!currency) throw new Error("missing_currency");

  const policy = ruleSet.policy && typeof ruleSet.policy === "object" ? ruleSet.policy : {};
  const rounding = policy.rounding || "integer";
  if (!["integer", "two_decimals"].includes(rounding)) throw new Error("invalid_rounding");

  // Input constraints (optional)
  const input = policy.input_constraints && typeof policy.input_constraints === "object" ? policy.input_constraints : {};
  if (input.allowed_line_types && !Array.isArray(input.allowed_line_types)) throw new Error("invalid_allowed_line_types");
  if (input.allow_negative_line_types && !Array.isArray(input.allow_negative_line_types)) throw new Error("invalid_allow_negative_line_types");

  // Legacy support: employer_tax_rate can be at root or in policy.
  const legacyEmployerTaxRate = ruleSet.employer_tax_rate ?? policy.employer_tax_rate;
  if (legacyEmployerTaxRate != null) assertRate(legacyEmployerTaxRate, "employer_tax_rate");

  // Derived rules (preferred)
  const rules = policy.derived_rules;
  if (rules != null) {
    if (!Array.isArray(rules)) throw new Error("invalid_derived_rules");
    for (const [i, r] of rules.entries()) validateDerivedRule(r, i);
  }

  return true;
}

function assertRate(v, field) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new Error(`invalid_${field}`);
}

function assertNonNegMoney(v, field) {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`invalid_${field}`);
}

function validateDerivedRule(r, i) {
  if (!r || typeof r !== "object") throw new Error(`invalid_derived_rule_${i}`);
  const type = String(r.type || "").trim();
  const out = String(r.out_line_type || "").trim();
  if (!type) throw new Error(`missing_derived_rule_type_${i}`);
  if (!out) throw new Error(`missing_out_line_type_${i}`);

  switch (type) {
    case "percentage_of_gross":
      assertRate(r.rate, `rate_${i}`);
      break;
    case "percentage_of_gross_with_cap":
      assertRate(r.rate, `rate_${i}`);
      assertNonNegMoney(r.cap_amount, `cap_amount_${i}`);
      break;
    case "threshold_piecewise_percentage":
      // Applies one rate up to threshold and another rate above threshold.
      assertNonNegMoney(r.threshold_amount, `threshold_amount_${i}`);
      assertRate(r.rate_below, `rate_below_${i}`);
      assertRate(r.rate_above, `rate_above_${i}`);
      break;
    case "per_employee_percentage_of_gross":
      if (!r.rate_by_employee_type || typeof r.rate_by_employee_type !== "object") {
        throw new Error(`invalid_rate_by_employee_type_${i}`);
      }
      for (const [k, v] of Object.entries(r.rate_by_employee_type)) assertRate(v, `rate_by_employee_type_${i}_${k}`);
      break;
    default:
      throw new Error(`unsupported_derived_rule_type_${i}_${type}`);
  }
}
