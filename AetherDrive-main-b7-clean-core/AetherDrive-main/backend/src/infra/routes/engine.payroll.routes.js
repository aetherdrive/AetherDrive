import express from "express";
import {
  createRun,
  addInputs,
  calculateRun,
  approveRun,
  commitRun,
  reconcileRun,
  forkRun,
} from "../../domain/payrollService.js";

import { hasDb } from "../db/dbClient.js";
import { withOrgDb } from "../middleware/orgDb.js";
import { repoList, repoGet, repoListVersions, repoGetVersion } from "../../domain/payrollRepository.js";

import { requireRole } from "../middleware/authz.js";
import { requireIntegrationKey } from "../middleware/integrationAuth.js";
import { hashRequestBody, checkIdempotency, storeIdempotency } from "../../domain/idempotencyService.js";
import { verifyRun as verifySignedRun } from "../../core/signing/signingService.js";

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
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const idem = maybeServeIdempotent(req, res, "POST /payroll-runs");
      if (idem) return;

      const { period_start, period_end, pay_date, currency, company_id, rule_set_version } = req.body || {};
      const ctx = {
        db: req.db,
        orgId: req.orgId,
        requestId: req.header("X-Request-Id") || null,
        actor: req.user?.sub || req.user?.id || null,
      };

      const run = await createRun(ctx, {
        companyId: company_id ?? 1,
        period_start,
        period_end,
        pay_date,
        currency,
        rule_set_version,
        policy_version: rule_set_version,
      });

      const response = { ok: true, run };
      storeIdem(req, "POST /payroll-runs", response, 201);
      return res.status(201).json(response);
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const idem = maybeServeIdempotent(req, res, "POST /payroll-runs");
      if (idem) return;

      const { period_start, period_end, pay_date, currency, company_id, rule_set_version } = req.body || {};
      const run = await createRun({}, {
        companyId: company_id ?? 1,
        period_start,
        period_end,
        pay_date,
        currency,
        rule_set_version,
        policy_version: rule_set_version,
      });

      const response = { ok: true, run };
      storeIdem(req, "POST /payroll-runs", response, 201);
      return res.status(201).json(response);
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// Fork + recompute (creates a new run)
enginePayrollRouter.post(
  "/payroll-runs/:id/recompute",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const parentId = req.params.id;
      const { rule_set_version } = req.body || {};
      const ctx = { db: req.db, orgId: req.orgId, requestId: req.header("X-Request-Id") || null, actor: req.user?.sub || req.user?.id || null };
      const forked = await forkRun(ctx, parentId, { rule_set_version });
      if (!forked) return res.status(404).json({ ok: false, error: "run_not_found" });
      const calculated = await calculateRun(ctx, forked.id);
      return res.status(201).json({ ok: true, run: calculated, parentRunId: parentId });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => res.status(501).json({ ok: false, error: "recompute_requires_db" }))
);

// Import payroll inputs
enginePayrollRouter.post(
  "/payroll-runs/:id/import",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const idem = maybeServeIdempotent(req, res, "POST /payroll-runs/:id/import");
      if (idem) return;

      const runId = req.params.id;
      const items = req.body?.items ?? req.body;
      const ctx = { db: req.db, orgId: req.orgId, requestId: req.header("X-Request-Id") || null, actor: req.user?.sub || req.user?.id || null };
      const updated = await addInputs(ctx, runId, items);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });

      const response = { ok: true, run: updated };
      storeIdem(req, "POST /payroll-runs/:id/import", response, 200);
      return res.json(response);
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const idem = maybeServeIdempotent(req, res, "POST /payroll-runs/:id/import");
      if (idem) return;
      const runId = req.params.id;
      const items = req.body?.items ?? req.body;
      const updated = await addInputs({}, runId, items);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      const response = { ok: true, run: updated };
      storeIdem(req, "POST /payroll-runs/:id/import", response, 200);
      return res.json(response);
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// Calculate a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/calculate",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const ctx = { db: req.db, orgId: req.orgId, requestId: req.header("X-Request-Id") || null, actor: req.user?.sub || req.user?.id || null };
      const updated = await calculateRun(ctx, runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const runId = req.params.id;
      const updated = await calculateRun({}, runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// Approve a payroll run
enginePayrollRouter.post(
  "/payroll-runs/:id/approve",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const ctx = { db: req.db, orgId: req.orgId, requestId: req.header("X-Request-Id") || null, actor: req.user?.sub || req.user?.id || null };
      const updated = await approveRun(ctx, runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const runId = req.params.id;
      const updated = await approveRun({}, runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// Commit a payroll run (locks it)
enginePayrollRouter.post(
  "/payroll-runs/:id/commit",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const ctx = { db: req.db, orgId: req.orgId, requestId: req.header("X-Request-Id") || null, actor: req.user?.sub || req.user?.id || null };
      const updated = await commitRun(ctx, runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const runId = req.params.id;
      const updated = await commitRun({}, runId);
      if (!updated) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run: updated });
    } catch (err) {
      return sendError(res, err);
    }
  })
);


// Verify cryptographic signature of a committed run (tamper-evident receipt)
enginePayrollRouter.get(
  "/payroll-runs/:id/verify",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const run = await repoGet(runId, req.db);
      if (!run) return res.status(404).json({ ok: false, error: "run_not_found" });
      const v = verifySignedRun(run);
      return res.json({ ok: true, runId, signature_valid: v.valid, key_version: v.key_version, reason: v.reason || null });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => res.status(501).json({ ok: false, error: "verify_requires_db" }))
);

// Reconcile a payroll run
enginePayrollRouter.get(
  "/payroll-runs/:id/reconciliation",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const ctx = { db: req.db, orgId: req.orgId, requestId: req.header("X-Request-Id") || null, actor: req.user?.sub || req.user?.id || null };
      const report = await reconcileRun(ctx, runId);
      if (!report) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, report });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const runId = req.params.id;
      const report = await reconcileRun({}, runId);
      if (!report) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, report });
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// List runs (B2B embedded UX)
enginePayrollRouter.get(
  "/payroll-runs",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const limit = req.query?.limit || 50;
      const runs = await repoList({ limit }, req.db);
      return res.json({ ok: true, runs });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const limit = req.query?.limit || 50;
      const runs = await repoList({ limit }, null);
      return res.json({ ok: true, runs });
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// Get run + versions
enginePayrollRouter.get(
  "/payroll-runs/:id",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const run = await repoGet(runId, req.db);
      if (!run) return res.status(404).json({ ok: false, error: "run_not_found" });
      const versions = await repoListVersions(runId, req.db);
      return res.json({ ok: true, run, versions });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => {
    try {
      const runId = req.params.id;
      const run = await repoGet(runId, null);
      if (!run) return res.status(404).json({ ok: false, error: "run_not_found" });
      return res.json({ ok: true, run, versions: [] });
    } catch (err) {
      return sendError(res, err);
    }
  })
);

// Diff between two versions (default: previous -> current)
enginePayrollRouter.get(
  "/payroll-runs/:id/diff",
  requireIntegrationKey,
  requireRole(["employer_admin", "accountant"]),
  (hasDb() ? withOrgDb(async (req, res) => {
    try {
      const runId = req.params.id;
      const run = await repoGet(runId, req.db);
      if (!run) return res.status(404).json({ ok: false, error: "run_not_found" });

      const toV = Number(req.query?.to || run.current_version || 1);
      const fromV = Number(req.query?.from || Math.max(1, toV - 1));

      const a = await repoGetVersion({ runId, version: fromV }, req.db);
      const b = await repoGetVersion({ runId, version: toV }, req.db);
      if (!a || !b) return res.status(404).json({ ok: false, error: "version_not_found" });

      const diff = {
        runId,
        from: fromV,
        to: toV,
        checksum: { from: a.checksum || null, to: b.checksum || null },
        status: { from: a.status, to: b.status },
        totals: {
          from: a.totals,
          to: b.totals,
          delta: {
            gross_total: (Number(b.totals?.gross_total||0) - Number(a.totals?.gross_total||0)),
            withholding_total: (Number(b.totals?.withholding_total||0) - Number(a.totals?.withholding_total||0)),
            employer_tax_total: (Number(b.totals?.employer_tax_total||0) - Number(a.totals?.employer_tax_total||0)),
            net_payable: (Number(b.totals?.net_payable||0) - Number(a.totals?.net_payable||0)),
          },
        },
        counts: {
          lines_from: (Array.isArray(a.inputs)?a.inputs.length:0) + (Array.isArray(a.derived)?a.derived.length:0),
          lines_to: (Array.isArray(b.inputs)?b.inputs.length:0) + (Array.isArray(b.derived)?b.derived.length:0),
        },
      };

      return res.json({ ok: true, diff });
    } catch (err) {
      return sendError(res, err);
    }
  }) : async (req, res) => res.status(501).json({ ok: false, error: "diff_requires_db" }))
);
