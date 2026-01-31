import express from "express";
import {
  createRun,
  addInputs,
  calculateRun,
  approveRun,
  commitRun,
  reconcileRun,
} from "../services/payrollService.js";

import { requireRole } from "../middleware/authz.js";
import { hashRequestBody, checkIdempotency, storeIdempotency } from "../services/idempotencyService.js";

export const enginePayrollRouter = express.Router();

/**
 * Helper: standardized error responses.
 */
function sendError(res, err) {
  const status = err?.status || 500;
  const code = err?.message || "internal_error";
  return res.status(status).json({ ok: false, error: code });
}

function maybeServeIdempotent(req, res, endpoint) {
  const key = req.header("X-Idempotency-Key") || null;
  const requestHash = hashRequestBody(req.body || {});
  const hit = checkIdempotency({ key, endpoint, requestHash });
  if (hit.hit) {
    return res.status(hit.status).json(hit.response);
  }
  return null;
}

function storeIdem(req, endpoint, response, status=200) {
  const key = req.header("X-Idempotency-Key") || null;
  const requestHash = hashRequestBody(req.body || {});
  storeIdempotency({ key, endpoint, requestHash, response, status });
}

// Create a new payroll run
enginePayrollRouter.post(
  "/payroll-runs",
  requireRole(["employer_admin", "accountant"]),
  (req, res) => {
    try {
      const idem = maybeServeIdempotent(req, res, "POST /payroll-runs");
      if (idem) return;

      const { period_start, period_end, pay_date, currency, company_id, rule_set_version } = req.body || {};
      const run = createRun({
        companyId: company_id ?? 1,
        period_start,
        period_end,
        pay_date,
        currency,
        rule_set_version,
      });

      const response = { ok: true, run };
      storeIdem(req, "POST /payroll-runs", response, 201);
      return res.status(201).json(response);
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// Import payroll inputs
enginePayrollRouter.post(
  "/payroll-runs/:id/import",
  requireRole(["employer_admin", "accountant"]),
  (req, res) => {
    try {
      const idem = maybeServeIdempotent(req, res, "POST /payroll-runs/:id/import");
      if (idem) return;

      const runId = req.params.id;
      const items = req.body?.items ?? req.body;
      const updated = addInputs(runId, items);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });

      const response = { ok: true, run: updated };
      storeIdem(req, "POST /payroll-runs/:id/import", response, 200);
      return res.json(response);
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// Calculate a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/calculate",
  requireRole(["employer_admin", "accountant"]),
  (req, res) => {
    try {
      const runId = req.params.id;
      const updated = calculateRun(runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// Approve a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/approve",
  requireRole(["employer_admin", "accountant"]),
  (req, res) => {
    try {
      const runId = req.params.id;
      const updated = approveRun(runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// Commit a payroll run (locks it)
enginePayrollRouter.post(
  "/payroll-runs/:id/commit",
  requireRole(["employer_admin", "accountant"]),
  (req, res) => {
    try {
      const runId = req.params.id;
      const updated = commitRun(runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  }
);

// Reconcile a payroll run
enginePayrollRouter.get(
  "/payroll-runs/:id/reconciliation",
  requireRole(["employer_admin", "accountant"]),
  (req, res) => {
    try {
      const runId = req.params.id;
      const report = reconcileRun(runId);
      if (!report) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, report });
    } catch (err) {
      return sendError(res, err);
    }
  }
);
