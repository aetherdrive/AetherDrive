import express from "express";
import { requireRole } from "../../../infra/middleware/authz.js";
import { requireIntegrationKey } from "../../../infra/middleware/integrationAuth.js";
import { queueAmelding } from "../../services/altinnService.js";
import { reconcileRun } from "../../../domain/payrollService.js";

export const integrationsRouter = express.Router();

integrationsRouter.post("/amelding/:runId", requireIntegrationKey, requireRole(["employer_admin","accountant"]), async (req,res) => {
  const runId = req.params.runId;
  const report = await reconcileRun(runId);
  if (!report) return res.status(404).json({ ok: false, error: "run_not_found" });
  const period = report.period_start.slice(0,7);
  const job = queueAmelding({ runId, companyId: report.companyId, period });
  return res.status(202).json({ ok: true, job, message: "queued_for_submission" });
});
