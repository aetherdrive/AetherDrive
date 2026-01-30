// Payroll engine routes for AetherDrive backend
//
// This router defines endpoints for creating and managing payroll runs.
// Endpoints are prefixed by `/api` when mounted in server.js. Each handler
// currently returns a placeholder response. Business logic and DB access
// should be implemented in a separate service layer.

import express from "express";
// Import the payroll service functions. These functions provide
// simple in-memory JSON persistence for payroll runs. They live in
// backend/src/services/payrollService.js and will be used to handle
// each endpoint below.
import {
  createRun,
  addInputs,
  calculateRun,
  approveRun,
  commitRun,
  reconcileRun
} from "../services/payrollService.js";

// Role-based access control middleware
import { requireRole } from "../middleware/authz.js";

export const enginePayrollRouter = express.Router();

// Health endpoint for the payroll engine
enginePayrollRouter.get("/payroll-health", (req, res) => {
  res.json({ ok: true, service: "payroll-engine" });
});

// Create a new payroll run
enginePayrollRouter.post(
  "/payroll-runs",
  requireRole(["employer_admin", "accountant"]),
  async (req, res) => {
  try {
    const { period_start, period_end, pay_date, currency, company_id, rule_set_version } = req.body || {};
    // Basic validation: all date fields must be provided and valid ISO strings
    function isValidDate(str) {
      return typeof str === "string" && !Number.isNaN(new Date(str).getTime());
    }
    if (!isValidDate(period_start) || !isValidDate(period_end) || !isValidDate(pay_date)) {
      return res.status(400).json({ ok: false, error: "invalid_date" });
    }
    const startDate = new Date(period_start);
    const endDate = new Date(period_end);
    const payDate = new Date(pay_date);
    if (startDate > endDate) {
      return res.status(400).json({ ok: false, error: "period_start_after_end" });
    }
    if (endDate > payDate) {
      return res.status(400).json({ ok: false, error: "pay_date_before_end" });
    }
    // Provide a default companyId of 1 if not supplied. In a real app
    // this would come from the authenticated user's organization.
    const run = createRun({
      companyId: company_id ?? 1,
      period_start,
      period_end,
      pay_date,
      currency,
      rule_set_version
    });
    res.status(201).json({ ok: true, run });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
  }
);

// Import inputs for a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/import",
  requireRole(["employer_admin", "accountant"]),
  async (req, res) => {
  try {
    const runId = req.params.id;
    // Accept inputs in the body; if 'items' is present use it, otherwise
    // treat the body as an array of inputs. Validate each input has an amount
    // (number) and line_type (string).
    const items = req.body?.items ?? req.body;
    const arr = Array.isArray(items) ? items : [];
    const invalid = arr.some((it) => {
      return (
        typeof it !== "object" ||
        typeof it.amount !== "number" ||
        Number.isNaN(it.amount) ||
        typeof it.line_type !== "string"
      );
    });
    if (invalid) {
      return res.status(400).json({ ok: false, error: "invalid_input_items" });
    }
    const updated = addInputs(runId, arr);
    if (!updated) {
      return res.status(409).json({ ok: false, error: "invalid_operation" });
    }
    res.json({ ok: true, run: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
  }
);

// Calculate a payroll run without committing
enginePayrollRouter.post(
  "/payroll-runs/:id/calculate",
  requireRole(["employer_admin", "accountant"]),
  async (req, res) => {
  try {
    const runId = req.params.id;
    const result = calculateRun(runId);
    if (!result) {
      return res.status(409).json({ ok: false, error: "invalid_operation" });
    }
    res.json({ ok: true, runId: result.runId, totals: result.totals });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
  }
);

// Approve a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/approve",
  requireRole(["employer_admin", "accountant"]),
  async (req, res) => {
  try {
    const runId = req.params.id;
    const approverId = req.body?.approver_id ?? null;
    const updated = approveRun(runId, approverId);
    if (!updated) {
      return res.status(409).json({ ok: false, error: "invalid_operation" });
    }
    res.json({ ok: true, run: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
  }
);

// Commit (lock) a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/commit",
  requireRole(["employer_admin", "accountant"]),
  async (req, res) => {
  try {
    const runId = req.params.id;
    const updated = commitRun(runId);
    if (!updated) {
      return res.status(409).json({ ok: false, error: "invalid_operation" });
    }
    res.json({ ok: true, run: updated });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
  }
);

// Reconciliation endpoint
enginePayrollRouter.get(
  "/payroll-runs/:id/reconciliation",
  requireRole(["employer_admin", "accountant"]),
  async (req, res) => {
  try {
    const runId = req.params.id;
    const result = reconcileRun(runId);
    if (!result) {
      return res.status(404).json({ ok: false, error: "run_not_found" });
    }
    res.json({ ok: true, runId: result.runId, status: result.status, totals: result.totals });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
  }
);