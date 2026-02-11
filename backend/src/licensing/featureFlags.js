// licensing/featureFlags.js (ESM)

export const PLANS = Object.freeze({
  PILOT: "pilot",
  STARTER: "starter",
  PRO: "pro",
  ENTERPRISE: "enterprise"
});

const PLAN_FEATURES = {
  [PLANS.PILOT]: ["timebank_import", "reporting_basic", "audit_basic"],
  [PLANS.STARTER]: ["timebank_import", "reporting_basic", "audit_basic", "writeback_basic"],
  [PLANS.PRO]: ["timebank_import", "reporting_pro", "audit_full", "writeback_full", "bankfile_pain001"],
  [PLANS.ENTERPRISE]: ["timebank_import", "reporting_pro", "audit_full", "writeback_full", "bankfile_pain001", "altinn_amelding"]
};

export function getCompanyPlan(companyId) {
  const envKey = `PB_PLAN_${companyId}`;
  return process.env[envKey] || process.env.PB_DEFAULT_PLAN || PLANS.PILOT;
}

export function hasFeature(companyId, feature) {
  const plan = getCompanyPlan(companyId);
  const allowed = PLAN_FEATURES[plan] || [];
  return allowed.includes(feature);
}

export function requireFeature(feature) {
  return (req, res, next) => {
    const companyId = req.body?.company_id ?? req.body?.companyId ?? req.query?.company_id ?? req.params?.company_id;
    if (!companyId) return res.status(400).json({ ok: false, error: "missing_company_id" });
    if (!hasFeature(String(companyId), feature)) return res.status(403).json({ ok: false, error: "feature_not_enabled", feature });
    next();
  };
}
